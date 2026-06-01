"""Tests for the Dagatal (event calendar) page."""

from fastapi.testclient import TestClient

from app.main import app
from app.routes import dagatal

client = TestClient(app)


# --- fixtures -------------------------------------------------------------

# One future event, one past event, relative to the fixed `today` below.
# Field shape mirrors calendar.json exactly (oldest-first, but split_calendar
# must not assume input order — it sorts each bucket itself).
SAMPLE_EVENTS = [
    {
        "date": "2026-01-10",
        "cube": "Meta Memories",
        "cube_slug": "meta-memories",
        "host": "diddi",
        "players": 13,
        "link": "https://cubecobra.com/cube/list/abc",
    },
    {
        "date": "2026-12-31",
        "cube": "Vintage Aron",
        "cube_slug": "vintage-aron",
        "host": "aron ívars",
        "players": None,
        "link": "https://cubecobra.com/cube/list/def",
    },
]

TODAY = "2026-06-01"


# --- split_calendar -------------------------------------------------------

def test_split_calendar_separates_future_and_past():
    result = dagatal.split_calendar(SAMPLE_EVENTS, TODAY)
    assert [e["date"] for e in result["upcoming"]] == ["2026-12-31"]
    assert [e["date"] for e in result["past"]] == ["2026-01-10"]


def test_split_calendar_upcoming_includes_today():
    events = [{"date": TODAY, "cube": "X", "cube_slug": "x",
               "host": None, "players": None, "link": None}]
    result = dagatal.split_calendar(events, TODAY)
    assert [e["date"] for e in result["upcoming"]] == [TODAY]
    assert result["past"] == []


def test_split_calendar_orders_upcoming_ascending():
    events = [
        {"date": "2026-09-01", "cube": "C", "cube_slug": "c",
         "host": None, "players": None, "link": None},
        {"date": "2026-07-01", "cube": "A", "cube_slug": "a",
         "host": None, "players": None, "link": None},
        {"date": "2026-08-01", "cube": "B", "cube_slug": "b",
         "host": None, "players": None, "link": None},
    ]
    result = dagatal.split_calendar(events, TODAY)
    assert [e["date"] for e in result["upcoming"]] == [
        "2026-07-01", "2026-08-01", "2026-09-01"]


def test_split_calendar_orders_past_descending():
    events = [
        {"date": "2026-01-01", "cube": "A", "cube_slug": "a",
         "host": None, "players": None, "link": None},
        {"date": "2026-03-01", "cube": "C", "cube_slug": "c",
         "host": None, "players": None, "link": None},
        {"date": "2026-02-01", "cube": "B", "cube_slug": "b",
         "host": None, "players": None, "link": None},
    ]
    result = dagatal.split_calendar(events, TODAY)
    assert [e["date"] for e in result["past"]] == [
        "2026-03-01", "2026-02-01", "2026-01-01"]


def test_split_calendar_empty_input():
    result = dagatal.split_calendar([], TODAY)
    assert result == {"upcoming": [], "past": []}


# --- route smoke ----------------------------------------------------------

def test_dagatal_route_200(monkeypatch):
    monkeypatch.setattr(dagatal, "load_calendar", lambda: SAMPLE_EVENTS)
    resp = client.get("/dagatal")
    assert resp.status_code == 200
    body = resp.text
    # mana hero H1 + the upcoming card title are present
    assert "Dagatal" in body
    assert "Væntanlegir viðburðir" in body
    # upcoming row (future event) rendered with DD.MM.YYYY date
    assert "31.12.2026" in body
    # past row collapsed under the details toggle, with its count
    assert "Liðnir viðburðir (1)" in body
    assert "10.01.2026" in body


def test_dagatal_route_empty(monkeypatch):
    monkeypatch.setattr(dagatal, "load_calendar", lambda: [])
    resp = client.get("/dagatal")
    assert resp.status_code == 200
    # empty-state string for no upcoming events
    assert "Engin viðburðir á dagskrá" in resp.text
