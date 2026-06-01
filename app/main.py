"""mtgkubbur.is — FastAPI entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from app import data
from app.config import STATIC_DIR
from app.routes import data_api, einvigi, rankings, throun
from app.templating import templates

logger = logging.getLogger(__name__)


class CachedStaticFiles(StaticFiles):
    def __init__(self, *args, max_age: int = 86400, **kwargs):
        super().__init__(*args, **kwargs)
        self._cc = f"public, max-age={max_age}"

    async def get_response(self, path: str, scope: Scope):
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            resp.headers.setdefault("Cache-Control", self._cc)
        return resp


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        data.prewarm()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Prewarm failed: %s", exc)
    yield


app = FastAPI(title="mtgkubbur.is", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
app.mount("/static", CachedStaticFiles(directory=STATIC_DIR), name="static")
app.include_router(data_api.router)
app.include_router(rankings.router)
app.include_router(throun.router)
app.include_router(einvigi.router)
# Page routers are added by their tasks:
# kubbar / dagatal / methods


@app.get("/healthz")
async def healthz() -> JSONResponse:
    ok = data.healthz_ok()
    return JSONResponse(
        {"status": "ok" if ok else "degraded"}, status_code=200 if ok else 503
    )


@app.exception_handler(404)
async def not_found(request: Request, _exc: Exception) -> HTMLResponse:
    return templates.TemplateResponse(request, "404.html", {"page": ""}, status_code=404)
