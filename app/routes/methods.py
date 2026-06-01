"""Aðferðafræði — Statistical Methods (English, static prose + LaTeX/MathJax).

Parity with mtgkubbur.github.io/methods.qmd. Not in the navbar; page="methods".
The only dynamic input is meta.fit_date (model fit date), surfaced read-only.
"""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.data import load_meta
from app.templating import templates

router = APIRouter()


@router.get("/methods", response_class=HTMLResponse)
async def methods(request: Request):
    meta = load_meta()
    return templates.TemplateResponse(
        request,
        "methods.html",
        {"page": "methods", "meta": meta},
    )
