"""Per-request JSON access for the published cube_rankings contract.

All access is fail-soft: a missing/malformed file logs and yields None/[]/{}.
Shapes are documented in .phase2-research/03-json-contract.md (authoritative).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path

from app.config import KUBBUR_DIR

logger = logging.getLogger(__name__)

# --- Tier vocabulary (JSON values) + UI mappings ---------------------------
TIERS = ["High", "Medium", "Low", "Other"]  # UI display order
TIER_LABEL = {"High": "High", "Medium": "Medium", "Low": "Low", "Other": "Annað"}
TIER_COLOUR_VAR = {
    "High": "--mtg-red",
    "Medium": "--mtg-blue",
    "Low": "--mtg-green",
    "Other": "--mtg-gold",
}

# --- Icelandic collation ----------------------------------------------------
_IS_ALPHABET = "aábcdðeéfghiíjklmnoópqrstuúvwxyýzþæö"
_IS_RANK = {ch: i for i, ch in enumerate(_IS_ALPHABET)}


def icelandic_sort_key(s: str) -> tuple[int, ...]:
    """Approximate Icelandic alphabetical order (case-insensitive)."""
    return tuple(_IS_RANK.get(ch, len(_IS_ALPHABET)) for ch in s.casefold())


# --- Low-level loader -------------------------------------------------------
def load_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("Failed to load %s: %s", path, exc)
        return None


# --- Cache ------------------------------------------------------------------
_cache: dict[str, object] = {}


def _cached(key: str, loader: Callable[[], object]) -> object:
    if key not in _cache:
        _cache[key] = loader()
    return _cache[key]


def _reset_cache() -> None:  # test hook
    _cache.clear()


# --- Top-level files --------------------------------------------------------
def load_meta() -> dict:
    return _cached("meta", lambda: load_json(KUBBUR_DIR / "meta.json") or {})


def load_rankings() -> list[dict]:
    return _cached("rankings", lambda: load_json(KUBBUR_DIR / "rankings.json") or [])


def load_calendar() -> list[dict]:
    return _cached("calendar", lambda: load_json(KUBBUR_DIR / "calendar.json") or [])


def load_cubes_index() -> list[dict]:
    return _cached("cubes", lambda: load_json(KUBBUR_DIR / "cubes.json") or [])


def load_head_to_head() -> list[dict]:
    return _cached("h2h", lambda: load_json(KUBBUR_DIR / "head_to_head.json") or [])


# --- Per-entity files -------------------------------------------------------
def load_player(slug: str) -> dict | None:
    return load_json(KUBBUR_DIR / "players" / f"{slug}.json")


def load_cube(slug: str) -> dict | None:
    return load_json(KUBBUR_DIR / "cubes" / f"{slug}.json")


# --- Indexes ----------------------------------------------------------------
def player_index() -> list[dict]:
    def build() -> list[dict]:
        out: list[dict] = []
        pdir = KUBBUR_DIR / "players"
        if pdir.is_dir():
            for f in sorted(pdir.glob("*.json")):
                payload = load_json(f)
                if isinstance(payload, dict) and payload.get("player"):
                    out.append({"slug": f.stem, "name": payload["player"]})
        out.sort(key=lambda p: icelandic_sort_key(p["name"]))
        return out

    return _cached("player_index", build)  # type: ignore[return-value]


def cube_index() -> list[dict]:
    def build() -> list[dict]:
        out = [
            {"slug": c["slug"], "cube": c["cube"], "tier": c.get("tier")}
            for c in load_cubes_index()
            if c.get("slug") and c.get("cube")
        ]
        out.sort(key=lambda c: icelandic_sort_key(c["cube"]))
        return out

    return _cached("cube_index", build)  # type: ignore[return-value]


# --- Lifespan + health ------------------------------------------------------
def prewarm() -> None:
    for fn in (
        load_meta,
        load_rankings,
        load_calendar,
        load_cubes_index,
        load_head_to_head,
        player_index,
        cube_index,
    ):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Prewarm %s failed: %s", fn.__name__, exc)


def healthz_ok() -> bool:
    return bool(load_rankings())
