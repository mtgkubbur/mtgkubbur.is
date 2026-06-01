"""Kubbar page — per-cube stats, trophies, player rankings, event results.

Tier 1 (this module): server-renders the shell + a cube <select> built from
cube_index(). Tier 2 (shared, Task 8): GET /data/cubes/{slug} ships the JSON
that app/static/js/kubbar.js fetches and renders client-side.
"""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app import data
from app.strings import STRINGS
from app.templating import templates

router = APIRouter()
_S = STRINGS["is"]


@router.get("/kubbar", response_class=HTMLResponse)
async def kubbar(request: Request):
    ctx = {
        "page": "kubbar",
        "header_h1": _S["kubbar_title"],
        "header_desc": _S["kubbar_desc"],
        "cubes": data.cube_index(),  # [{"slug","cube","tier"}] icelandic-sorted by cube
    }
    return templates.TemplateResponse(request, "kubbar.html", ctx)
