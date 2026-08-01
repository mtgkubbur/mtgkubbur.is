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


def test_flatten_returns_empty_strings_when_no_image_is_available():
    """flatten_card stays a pure transform: no images anywhere -> empty strings, not an error.

    build_cache (not flatten_card) is responsible for turning this into a hard failure.
    """
    out = scryfall.flatten_card(SAMPLE["Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun"])
    assert out["img_small"] == ""
    assert out["img_normal"] == ""


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


def test_build_cache_raises_when_a_resolved_card_has_no_usable_image(monkeypatch):
    """A card that resolves but carries no image anywhere must not be cached silently.

    This is distinct from the unresolved-name failure: the name was found on Scryfall,
    but flatten_card's pure fallback chain still bottomed out at "". Seam: monkeypatch
    scryfall.resolve, since build_cache calls resolve() directly by its module-global name.
    """
    imageless = scryfall.flatten_card(SAMPLE["Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun"])

    def fake_resolve(names):
        return {"Growing Rites of Itlimoc": imageless}, []

    monkeypatch.setattr(scryfall, "resolve", fake_resolve)
    with pytest.raises(ValueError, match="no usable image"):
        scryfall.build_cache(["Growing Rites of Itlimoc"])


def test_build_cache_still_reports_unresolved_names_distinctly(monkeypatch):
    """The two failure modes ("can't find the name" vs "found it, no image") must not be conflated."""

    def fake_resolve(names):
        return {}, ["Nonexistent Card"]

    monkeypatch.setattr(scryfall, "resolve", fake_resolve)
    with pytest.raises(ValueError, match="could not resolve"):
        scryfall.build_cache(["Nonexistent Card"])


def test_merge_cache_makes_zero_fetches_when_every_name_is_already_cached(monkeypatch):
    """The headline efficiency claim: a fully-cached request must not touch build_cache at all.

    Seam: monkeypatch scryfall.build_cache (merge_cache calls it by module-global name), and
    make the fake raise if invoked so the zero-fetch property is asserted, not just observed.
    """

    def fake_build_cache(names):
        raise AssertionError(f"build_cache must not be called when every name is cached, got {names!r}")

    monkeypatch.setattr(scryfall, "build_cache", fake_build_cache)
    existing = {
        "Lightning Bolt": scryfall.flatten_card(SAMPLE["Lightning Bolt"]),
        "Brazen Borrower": scryfall.flatten_card(SAMPLE["Brazen Borrower // Petty Theft"]),
    }
    result = scryfall.merge_cache(existing, ["Lightning Bolt", "Brazen Borrower"])
    assert result == existing


def test_merge_cache_fetches_only_the_uncached_names(monkeypatch):
    calls: list[list[str]] = []

    def fake_build_cache(names):
        calls.append(list(names))
        return {"Thing in the Ice": scryfall.flatten_card(SAMPLE["Thing in the Ice // Awoken Horror"])}

    monkeypatch.setattr(scryfall, "build_cache", fake_build_cache)
    existing = {"Lightning Bolt": scryfall.flatten_card(SAMPLE["Lightning Bolt"])}
    result = scryfall.merge_cache(existing, ["Lightning Bolt", "Thing in the Ice"])
    assert calls == [["Thing in the Ice"]]
    assert set(result) == {"Lightning Bolt", "Thing in the Ice"}
    assert result["Lightning Bolt"] == existing["Lightning Bolt"]
    assert result["Thing in the Ice"]["name"] == "Thing in the Ice // Awoken Horror"


def test_merge_cache_drops_names_no_longer_requested(monkeypatch):
    existing = {
        "Lightning Bolt": scryfall.flatten_card(SAMPLE["Lightning Bolt"]),
        "Brazen Borrower": scryfall.flatten_card(SAMPLE["Brazen Borrower // Petty Theft"]),
    }
    monkeypatch.setattr(scryfall, "build_cache", lambda names: {})
    result = scryfall.merge_cache(existing, ["Lightning Bolt"])
    assert set(result) == {"Lightning Bolt"}
