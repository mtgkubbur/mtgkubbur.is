"""Rotisserie draft page — unlisted.

Deliberately absent from the nav and marked noindex. No authentication: the
source Google Sheet is already world-readable, so the page discloses nothing
new and auth would be theatre. See the design spec for the full reasoning.
"""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.strings import STRINGS
from app.templating import templates

router = APIRouter()
_S = STRINGS["is"]


@router.get("/rotisserie", response_class=HTMLResponse)
async def rotisserie(request: Request):
    ctx = {
        "page": "rotisserie",
        "header_h1": _S["rotisserie_title"],
        "header_desc": _S["rotisserie_desc"],
    }
    return templates.TemplateResponse(request, "rotisserie.html", ctx)
