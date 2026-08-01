"""Resolve cube card names to a flat, render-ready cache.

A cube is a closed set, so this runs only when an unknown name appears and its
output is committed. The site never calls Scryfall at runtime.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Iterator, Sequence

API = "https://api.scryfall.com"
USER_AGENT = "mtgkubbur.is/0.1 (+https://mtgkubbur.is; rotisserie draft page)"
BATCH_LIMIT = 75  # Scryfall's documented maximum identifiers per collection request
REQUEST_PAUSE_S = 0.15  # Scryfall asks for <= 10 req/s; this is comfortably under

# Reserved key stored alongside card entries in the cache file so a change to
# flatten_card's output shape (e.g. Fix 1's colour/cost handling) forces a
# full rebuild automatically, instead of depending on someone remembering to
# delete the cache file by hand. No real Scryfall card name contains a double
# underscore, so this cannot collide with a card name; every consumer of the
# cache (schema, tests, the /data/rotisserie payload) must treat it as
# bookkeeping, not a card.
CACHE_META_KEY = "__cache_meta__"
CACHE_VERSION = 2  # bump whenever flatten_card's output shape changes


def chunk(items: Sequence[str], size: int = BATCH_LIMIT) -> Iterator[list[str]]:
    for i in range(0, len(items), size):
        yield list(items[i : i + size])


def _request(url: str, payload: dict | None = None, timeout: int = 30) -> dict | None:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https host
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def fetch_batch(names: Sequence[str]) -> tuple[dict[str, dict], list[str]]:
    """POST /cards/collection. Returns (by Scryfall name, not-found names)."""
    body = {"identifiers": [{"name": n} for n in names]}
    payload = _request(f"{API}/cards/collection", body) or {}
    found = {c["name"]: c for c in payload.get("data", [])}
    missing = [i.get("name", "") for i in payload.get("not_found", [])]
    time.sleep(REQUEST_PAUSE_S)
    return found, missing


def fetch_one(name: str) -> dict | None:
    """GET /cards/named, exact then fuzzy.

    Needed because split-layout Room cards such as
    'Unholy Annex // Ritual Chamber' come back not_found from the batch
    endpoint yet resolve fine here.
    """
    for mode in ("exact", "fuzzy"):
        query = urllib.parse.urlencode({mode: name})
        card = _request(f"{API}/cards/named?{query}")
        time.sleep(REQUEST_PAUSE_S)
        if card:
            return card
    return None


def flatten_card(card: dict) -> dict:
    """Reduce a Scryfall card to what the page renders.

    Resolves the image fallback at build time so the frontend never branches:
    transform and modal_dfc cards carry no top-level image_uris.
    """
    faces = card.get("card_faces") or []
    front = faces[0] if faces else {}

    images = card.get("image_uris")
    if not images:
        images = front.get("image_uris") or {}

    # Scryfall omits the top-level colors/mana_cost keys entirely (not just
    # empty) for transform and modal_dfc cards -- the values live per-face.
    # `card.get("colors") or []` would conflate "key omitted" with "genuinely
    # colourless" (Bomat Courier, Spellskite, Cranial Plating do carry an
    # empty top-level colors list and must stay colourless), so key on
    # presence rather than truthiness. Fall back to the *front* face only,
    # not a union of both faces: a player identifies a double-faced card by
    # its front (Valki, God of Lies reads as black, not black-red), and the
    # type-line grouping in rotisserie.js is front-face-based for the same
    # reason -- keeping both front-face-only keeps the colour and type
    # groupings consistent with each other.
    colors = card["colors"] if "colors" in card else front.get("colors") or []
    mana_cost = card["mana_cost"] if "mana_cost" in card else front.get("mana_cost", "")

    uri = str(card.get("scryfall_uri", ""))
    return {
        "name": card.get("name", ""),
        "mana_cost": mana_cost,
        "cmc": int(card.get("cmc") or 0),
        "type_line": card.get("type_line", ""),
        "colors": list(colors),
        "color_identity": list(card.get("color_identity") or []),
        "rarity": card.get("rarity", ""),
        "layout": card.get("layout", ""),
        "img_small": images.get("small", ""),
        "img_normal": images.get("normal", ""),
        "scryfall_uri": uri.split("?", 1)[0],
    }


def build_alias_index(by_name: dict[str, dict]) -> dict[str, str]:
    """Map every name a sheet might use to the canonical Scryfall name.

    The sheet stores front-face names ('Brazen Borrower'); Scryfall returns
    full names ('Brazen Borrower // Petty Theft'). 539 cards yield 564 aliases.
    """
    alias: dict[str, str] = {}
    for full, card in by_name.items():
        alias.setdefault(full, full)
        alias.setdefault(full.split(" // ", 1)[0], full)
        for face in card.get("card_faces") or []:
            if face.get("name"):
                alias.setdefault(face["name"], full)
    return alias


def resolve(
    names: Sequence[str],
    fetch_batch: Callable[[Sequence[str]], tuple[dict[str, dict], list[str]]] = fetch_batch,
    fetch_one: Callable[[str], dict | None] = fetch_one,
) -> tuple[dict[str, dict], list[str]]:
    """Resolve sheet names to flattened cards. Returns (cache, unresolved names)."""
    unique = list(dict.fromkeys(names))
    raw: dict[str, dict] = {}
    retry: list[str] = []
    for batch in chunk(unique):
        found, missing = fetch_batch(batch)
        raw.update(found)
        retry.extend(missing)

    for name in retry:
        card = fetch_one(name)
        if card:
            raw[card["name"]] = card

    alias = build_alias_index(raw)
    cache: dict[str, dict] = {}
    unresolved: list[str] = []
    for name in unique:
        canonical = alias.get(name)
        if canonical is None:
            unresolved.append(name)
            continue
        cache[name] = flatten_card(raw[canonical])
    return cache, unresolved


def build_cache(names: Sequence[str]) -> dict[str, dict]:
    cache, unresolved = resolve(names)
    if unresolved:
        raise ValueError(f"Scryfall could not resolve {len(unresolved)} card name(s): {unresolved[:10]}")
    imageless = sorted(n for n, c in cache.items() if not c["img_small"] or not c["img_normal"])
    if imageless:
        raise ValueError(f"{len(imageless)} card(s) resolved with no usable image: {imageless[:10]}")
    return cache


def merge_cache(existing: dict[str, dict], names: Iterable[str]) -> dict[str, dict]:
    """Fetch only names absent from the existing cache; drop names no longer in the cube.

    A cache-format version marker (CACHE_META_KEY) forces a full rebuild
    whenever it is missing or stale, so a change to flatten_card's output
    shape actually reaches already-cached cards instead of being stuck at
    zero (nothing looks "absent" to a name-presence check alone).
    """
    marker = existing.get(CACHE_META_KEY)
    is_current = isinstance(marker, dict) and marker.get("version") == CACHE_VERSION
    live = {n: c for n, c in existing.items() if n != CACHE_META_KEY} if is_current else {}

    wanted = list(dict.fromkeys(names))
    missing = [n for n in wanted if n not in live]
    fresh = build_cache(missing) if missing else {}

    def resolved(name: str) -> dict:
        if name in live:
            return live[name]
        if name in fresh:
            return fresh[name]
        # Unreachable in practice: build_cache raises on any name it cannot
        # resolve, so every "missing" name ends up in `fresh`. Named instead
        # of a bare KeyError so a violation of that contract is legible, and
        # so a falsy-but-cached entry (e.g. `{}`) is never mistaken for
        # "absent" the way `existing.get(n) or fresh[n]` would.
        raise KeyError(f"{name!r} is neither cached nor freshly fetched")

    cache = {n: resolved(n) for n in wanted}
    cache[CACHE_META_KEY] = {"version": CACHE_VERSION}
    return cache
