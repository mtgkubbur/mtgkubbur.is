"""mtgkubbur.is — FastAPI entrypoint (minimal; expanded in Task 8)."""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import STATIC_DIR

app = FastAPI(title="mtgkubbur.is", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok"})
