"""Card cache: front-face aliasing, face-image fallback, per-card retry."""

import json
from pathlib import Path

import pytest

from scripts.rotisserie import scryfall

FIXTURES = Path(__file__).parent / "fixtures" / "rotisserie"
SAMPLE = json.loads((FIXTURES / "cards_sample.json").read_text(encoding="utf-8"))


def test_flatten_plain_card():
    out = scryfall.flatten_card(SAMPLE["Lightning Bolt"])
    assert out["name"] == "Lightning Bolt"
    assert out["cmc"] == 1
    assert out["colors"] == ["R"]
    assert out["img_small"] == "https://cards.scryfall.io/small/bolt.jpg"
    assert out["img_normal"] == "https://cards.scryfall.io/normal/bolt.jpg"


def test_flatten_falls_back_to_first_face_images():
    """The 18 transform/MDFC cards in this cube have no top-level image_uris."""
    out = scryfall.flatten_card(SAMPLE["Thing in the Ice // Awoken Horror"])
    assert out["img_small"] == "https://cards.scryfall.io/small/thing.jpg"
    assert out["img_normal"] == "https://cards.scryfall.io/normal/thing.jpg"


def test_flatten_drops_scryfall_api_tracking_params():
    card = dict(SAMPLE["Lightning Bolt"], scryfall_uri="https://scryfall.com/card/x?utm_source=api")
    assert scryfall.flatten_card(card)["scryfall_uri"] == "https://scryfall.com/card/x"


def test_build_alias_index_maps_front_faces_and_split_halves():
    alias = scryfall.build_alias_index(SAMPLE)
    assert alias["Brazen Borrower"] == "Brazen Borrower // Petty Theft"
    assert alias["Thing in the Ice"] == "Thing in the Ice // Awoken Horror"
    assert alias["Lightning Bolt"] == "Lightning Bolt"


def test_resolve_uses_alias_for_front_face_sheet_names():
    def fetch_batch(names):
        return {k: v for k, v in SAMPLE.items()}, []

    def fetch_one(name):  # pragma: no cover - must not be reached
        raise AssertionError("retry should not be needed")

    cache, missing = scryfall.resolve(
        ["Lightning Bolt", "Brazen Borrower", "Thing in the Ice"],
        fetch_batch=fetch_batch,
        fetch_one=fetch_one,
    )
    assert missing == []
    assert set(cache) == {"Lightning Bolt", "Brazen Borrower", "Thing in the Ice"}
    assert cache["Brazen Borrower"]["name"] == "Brazen Borrower // Petty Theft"


def test_resolve_retries_batch_misses_individually():
    """Unholy Annex // Ritual Chamber is not_found in batch but resolves singly."""
    calls: list[str] = []

    def fetch_batch(names):
        return {"Lightning Bolt": SAMPLE["Lightning Bolt"]}, ["Unholy Annex // Ritual Chamber"]

    def fetch_one(name):
        calls.append(name)
        return dict(SAMPLE["Lightning Bolt"], name="Unholy Annex // Ritual Chamber")

    cache, missing = scryfall.resolve(
        ["Lightning Bolt", "Unholy Annex // Ritual Chamber"],
        fetch_batch=fetch_batch,
        fetch_one=fetch_one,
    )
    assert calls == ["Unholy Annex // Ritual Chamber"]
    assert missing == []
    assert cache["Unholy Annex // Ritual Chamber"]["name"] == "Unholy Annex // Ritual Chamber"


def test_resolve_reports_names_it_cannot_find():
    def fetch_batch(names):
        return {}, ["Nonexistent Card"]

    def fetch_one(name):
        return None

    cache, missing = scryfall.resolve(["Nonexistent Card"], fetch_batch=fetch_batch, fetch_one=fetch_one)
    assert cache == {}
    assert missing == ["Nonexistent Card"]


def test_resolve_deduplicates_before_requesting():
    seen: list[list[str]] = []

    def fetch_batch(names):
        seen.append(list(names))
        return {"Explore": dict(SAMPLE["Lightning Bolt"], name="Explore")}, []

    cache, missing = scryfall.resolve(["Explore", "Explore"], fetch_batch=fetch_batch, fetch_one=lambda n: None)
    assert seen == [["Explore"]]
    assert missing == []
    assert set(cache) == {"Explore"}


@pytest.mark.parametrize("size", [1, 74, 75, 76, 150, 151])
def test_chunk_respects_the_75_identifier_limit(size):
    chunks = list(scryfall.chunk([f"c{i}" for i in range(size)], 75))
    assert all(len(c) <= 75 for c in chunks)
    assert sum(len(c) for c in chunks) == size
