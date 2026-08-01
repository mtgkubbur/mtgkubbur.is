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
    images = card.get("image_uris")
    if not images:
        faces = card.get("card_faces") or []
        images = (faces[0].get("image_uris") if faces else None) or {}
    uri = str(card.get("scryfall_uri", ""))
    return {
        "name": card.get("name", ""),
        "mana_cost": card.get("mana_cost", ""),
        "cmc": int(card.get("cmc") or 0),
        "type_line": card.get("type_line", ""),
        "colors": list(card.get("colors") or []),
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
    return cache


def merge_cache(existing: dict[str, dict], names: Iterable[str]) -> dict[str, dict]:
    """Fetch only names absent from the existing cache; drop names no longer in the cube."""
    wanted = list(dict.fromkeys(names))
    missing = [n for n in wanted if n not in existing]
    fresh = build_cache(missing) if missing else {}
    return {n: (existing.get(n) or fresh[n]) for n in wanted}
