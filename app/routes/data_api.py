"""Shared /data/* JSON endpoints (tier 2 of two-tier serving)."""

from fastapi import APIRouter, HTTPException

from app import data

router = APIRouter(prefix="/data")


def _player_slugs() -> set[str]:
    return {p["slug"] for p in data.player_index()}


def _cube_slugs() -> set[str]:
    return {c["slug"] for c in data.cube_index()}


@router.get("/players/{slug}")
async def player_data(slug: str):
    if slug not in _player_slugs():
        raise HTTPException(status_code=404)
    payload = data.load_player(slug)
    if payload is None:
        raise HTTPException(status_code=404)
    return payload


@router.get("/cubes/{slug}")
async def cube_data(slug: str):
    if slug not in _cube_slugs():
        raise HTTPException(status_code=404)
    payload = data.load_cube(slug)
    if payload is None:
        raise HTTPException(status_code=404)
    return payload


@router.get("/head_to_head")
async def head_to_head_data():
    return data.load_head_to_head()
