"""Stigatafla (/) — ELO leaderboard.

Server-renders five tier panels (Allt + the four tiers) sharing one column
layout. The leaderboard filter is BAKED into rankings.json (`rank` / `<Tier>_rank`
are null when unqualified), so this module only filters out nulls and sorts by
the baked rank — it does NOT re-implement any games/win-rate/absence gate.
See .phase2-research/03-json-contract.md §2 and Plan B spec refinement #1.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app import data
from app.templating import templates

router = APIRouter()

# Display order of the four tiers within the cube-category filter / panels.
_TIERS = ["High", "Medium", "Low", "Other"]


# --- pure helpers (unit-tested) --------------------------------------------
def delta_cell(value: int | None) -> dict:
    """Map a delta integer to a render descriptor.

    None -> na "–" (en-dash); 0 -> zero "—" (em-dash);
    >0 -> up "+{v}"; <0 -> down "{v}" (already signed).
    """
    if value is None:
        return {"kind": "na", "text": "–"}  # –
    if value == 0:
        return {"kind": "zero", "text": "—"}  # —
    if value > 0:
        return {"kind": "up", "text": f"+{value}"}
    return {"kind": "down", "text": f"{value}"}


def winrate_bar_colour(pct: float) -> str:
    """Interpolate the win-rate bar colour red->green.

    t = clamp((pct-35)/30, 0, 1); rgb(231,76,60) -> rgb(46,204,113).
    """
    t = (pct - 35.0) / 30.0
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    r = round(231 + (46 - 231) * t)
    g = round(76 + (204 - 76) * t)
    b = round(60 + (113 - 60) * t)
    return f"rgb({r}, {g}, {b})"


def _podium(nr: int | None) -> int | None:
    return nr if nr in (1, 2, 3) else None


def _pct(wins, total) -> int | None:
    if wins is None or not total:
        return None
    return round(wins / total * 100)


def _allt_row(row: dict) -> dict:
    nr = row.get("rank")
    prev_elo = row.get("prev_score_median")
    nr_prev = row.get("prev_rank")
    elo = row.get("score_median")
    score_delta = (elo - prev_elo) if (elo is not None and prev_elo is not None) else None
    rank_delta = (nr_prev - nr) if (nr_prev is not None and nr is not None) else None
    return {
        "nr": nr,
        "player": row.get("player"),
        "wins": row.get("wins"),
        "losses": row.get("losses"),
        "pct": _pct(row.get("wins"), row.get("total")),
        "elo": elo,
        "prev_elo": prev_elo,
        "nr_prev": nr_prev,
        "podium": _podium(nr),
        "score_delta": score_delta,
        "rank_delta": rank_delta,
    }


def _tier_row(row: dict, tier: str) -> dict:
    nr = row.get(f"{tier}_rank")
    prev_elo = row.get(f"{tier}_prev_elo")
    nr_prev = row.get(f"{tier}_prev_rank")
    elo = row.get(f"{tier}_elo_median")
    score_delta = (elo - prev_elo) if (elo is not None and prev_elo is not None) else None
    rank_delta = (nr_prev - nr) if (nr_prev is not None and nr is not None) else None
    return {
        "nr": nr,
        "player": row.get("player"),
        "wins": row.get(f"{tier}_wins"),
        "losses": row.get(f"{tier}_losses"),
        "pct": _pct(row.get(f"{tier}_wins"), row.get(f"{tier}_total")),
        "elo": elo,
        "prev_elo": prev_elo,
        "nr_prev": nr_prev,
        "podium": _podium(nr),
        "score_delta": score_delta,
        "rank_delta": rank_delta,
    }


def build_tier_views(rankings: list[dict]) -> dict[str, list[dict]]:
    """Build the 5 panels. Keys: Allt, High, Medium, Low, Other.

    Allt  = rows with overall rank not None, sorted by rank asc.
    <Tier> = rows with <Tier>_rank not None, sorted by <Tier>_rank asc.
    """
    allt = sorted(
        (_allt_row(r) for r in rankings if r.get("rank") is not None),
        key=lambda r: r["nr"],
    )
    views: dict[str, list[dict]] = {"Allt": allt}
    for tier in _TIERS:
        rows = [r for r in rankings if r.get(f"{tier}_rank") is not None]
        views[tier] = sorted((_tier_row(r, tier) for r in rows), key=lambda r: r["nr"])
    return views


# --- route ------------------------------------------------------------------
# Panel definitions drive both the <select> options and the rendered panels.
# (selector option label, data-cube attr, views key)
_PANELS = [
    ("Allt", "Allt", "Allt"),
    (data.TIER_LABEL["High"], "High", "High"),
    (data.TIER_LABEL["Medium"], "Medium", "Medium"),
    (data.TIER_LABEL["Low"], "Low", "Low"),
    (data.TIER_LABEL["Other"], "Other", "Other"),
]


@router.get("/")
async def stigatafla(request: Request):
    meta = data.load_meta()
    views = build_tier_views(data.load_rankings())
    # attach the winrate bar colour to each row so the template stays logic-free
    for rows in views.values():
        for r in rows:
            r["bar_colour"] = winrate_bar_colour(r["pct"]) if r["pct"] is not None else None
            r["score_delta_cell"] = delta_cell(r["score_delta"])
            r["rank_delta_cell"] = delta_cell(r["rank_delta"])
    panels = [
        {"label": label, "data_cube": dc, "rows": views[key]} for (label, dc, key) in _PANELS
    ]
    ctx = {
        "page": "stigatafla",
        "header_subtitle": templates.env.globals["S"]["index_subtitle"],
        "header_badge": f'{templates.env.globals["S"]["updated_prefix"]} {meta.get("reference_date", "")}',
        "panels": panels,
    }
    return templates.TemplateResponse(request, "index.html", ctx)
