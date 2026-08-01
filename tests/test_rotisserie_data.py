"""Fail-soft loaders and the merged /data/rotisserie endpoint."""

from fastapi.testclient import TestClient

from app import data
from app.main import app

client = TestClient(app)


def test_load_rotisserie_returns_the_published_state():
    d = data.load_rotisserie()
    assert d["cube"] == "Meta Memories"
    assert len(d["players"]) == 8
    assert d["picks_total"] == d["rounds_total"] * len(d["players"])


def test_load_rotisserie_cards_covers_every_referenced_card():
    d, cards = data.load_rotisserie(), data.load_rotisserie_cards()
    referenced = {c for pool in d["pools"].values() for c in pool} | set(d["remaining"])
    assert referenced <= set(cards)


def test_loaders_are_fail_soft(monkeypatch, tmp_path):
    monkeypatch.setattr(data, "KUBBUR_DIR", tmp_path)
    data._reset_cache()
    try:
        assert data.load_rotisserie() == {}
        assert data.load_rotisserie_cards() == {}
    finally:
        data._reset_cache()


def test_data_endpoint_returns_draft_and_cards():
    r = client.get("/data/rotisserie")
    assert r.status_code == 200
    payload = r.json()
    assert set(payload) == {"draft", "cards"}
    assert payload["draft"]["cube"] == "Meta Memories"
    first = payload["draft"]["players"][0]
    assert first in payload["draft"]["pools"]
    assert payload["cards"], "card cache must not be empty"


def test_every_cached_card_has_images():
    cards = data.load_rotisserie_cards()
    broken = [n for n, c in cards.items() if not c.get("img_small") or not c.get("img_normal")]
    assert broken == []
