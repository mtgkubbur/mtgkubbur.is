"""Einvígi (/einvigi) — head-to-head shell: two player pickers + client-rendered card + chart 6."""

from fastapi import APIRouter, Request

from app import data
from app.strings import STRINGS
from app.templating import templates

router = APIRouter()

S = STRINGS["is"]


@router.get("/einvigi")
async def einvigi(request: Request):
    ctx = {
        "page": "einvigi",
        "players": data.player_index(),
        "header_h1": S["einvigi_title"],
        "header_desc": S["einvigi_desc"],
    }
    return templates.TemplateResponse(request, "einvigi.html", ctx)
