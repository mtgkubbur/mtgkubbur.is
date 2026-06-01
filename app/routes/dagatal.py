"""Dagatal — cube-night event calendar (fully server-rendered)."""

from datetime import date

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.data import load_calendar
from app.strings import STRINGS
from app.templating import templates

S = STRINGS["is"]

router = APIRouter()


def split_calendar(events: list[dict], today: str) -> dict:
    """Split calendar events into upcoming (date >= today, ascending) and
    past (date < today, descending).

    `events` shape mirrors calendar.json rows; `today` is an ISO date string
    (`YYYY-MM-DD`). Input order is not assumed — each bucket is sorted here.
    ISO date strings sort lexicographically, which equals chronological order.
    """
    upcoming = sorted(
        (e for e in events if e.get("date", "") >= today),
        key=lambda e: e.get("date", ""),
    )
    past = sorted(
        (e for e in events if e.get("date", "") < today),
        key=lambda e: e.get("date", ""),
        reverse=True,
    )
    return {"upcoming": upcoming, "past": past}


def _fmt_date(iso: str) -> str:
    """`YYYY-MM-DD` -> `DD.MM.YYYY`. Returns the input unchanged if it does
    not parse (fail-soft, consistent with the data layer)."""
    try:
        y, m, d = iso.split("-")
        return f"{d}.{m}.{y}"
    except (ValueError, AttributeError):
        return iso or ""


def _decorate(events: list[dict]) -> list[dict]:
    """Add presentation fields the template needs without logic in Jinja:
    `date_fmt` (DD.MM.YYYY) and `host_display` (title-cased host or "")."""
    decorated = []
    for e in events:
        host = e.get("host")
        decorated.append({
            **e,
            "date_fmt": _fmt_date(e.get("date", "")),
            "host_display": host.title() if host else "",
        })
    return decorated


@router.get("/dagatal", response_class=HTMLResponse)
async def dagatal_page(request: Request):
    today = date.today().isoformat()
    split = split_calendar(load_calendar(), today)
    upcoming = _decorate(split["upcoming"])
    past = _decorate(split["past"])

    ctx = {
        "page": "dagatal",
        "header_h1": S["dagatal_title"],
        "header_desc": S["dagatal_desc"],
        "upcoming": upcoming,
        "past": past,
    }
    return templates.TemplateResponse(request, "dagatal.html", ctx)
