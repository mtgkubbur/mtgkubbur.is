"""Leikmaður (player profile) page — /throun. Two-tier: shell + /data/players/{slug}."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app import data
from app.strings import STRINGS
from app.templating import templates

router = APIRouter()

S = STRINGS["is"]


def _footnote_parts() -> list[dict]:
    """Build the tier footnote rows from meta.tiers in UI order (High, Medium, Low, Other)."""
    tiers = data.load_meta().get("tiers") or {}
    parts: list[dict] = []
    for tier in data.TIERS:  # ["High", "Medium", "Low", "Other"]
        cubes = tiers.get(tier) or []
        if not cubes:
            continue
        parts.append({"label": data.TIER_LABEL[tier], "cubes": ", ".join(cubes)})
    return parts


@router.get("/throun", response_class=HTMLResponse)
async def throun(request: Request):
    ctx = {
        "page": "leikmadur",
        "header_h1": S["throun_title"],
        "header_desc": S["throun_desc"],
        "players": data.player_index(),
        "footnote_parts": _footnote_parts(),
    }
    return templates.TemplateResponse(request, "throun.html", ctx)
