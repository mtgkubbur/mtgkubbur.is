"""Kubbar page: shell renders, cube picker is server-populated, /data wiring intact."""

from fastapi.testclient import TestClient

from app import data
from app.main import app

client = TestClient(app)


def test_kubbar_page_200_and_active_nav():
    r = client.get("/kubbar")
    assert r.status_code == 200
    body = r.text
    # header copy
    assert "Kubbar" in body
    assert "Tölfræði og saga einstakra kubba" in body
    # cube picker label + placeholder + every cube as an <option value=slug>
    assert "Kubbur:" in body
    assert "Veldu kubb..." in body
    idx = data.cube_index()
    assert len(idx) >= 1
    first = idx[0]
    assert f'value="{first["slug"]}"' in body
    assert first["cube"] in body
    # empty-state copy + crossed-swords glyph
    assert "Veldu kubb til að sjá upplýsingar" in body
    assert "&#9876;" in body or "⚔" in body
    # mount points + selector wrappers the client JS targets
    for token in (
        'id="cube-page-selector"',
        'id="kubbar-summary"',
        'id="kubbar-trophy"',
        'id="kubbar-rankings"',
        'id="event-date-selector"',
        'id="kubbar-event"',
    ):
        assert token in body, token
    # active navbar link is Kubbar
    assert 'class="nav-link active" href="/kubbar"' in body


def test_kubbar_loads_kubbar_js():
    r = client.get("/kubbar")
    assert "/static/js/kubbar.js" in r.text


def test_kubbar_data_endpoint_serves_real_cube():
    slug = data.cube_index()[0]["slug"]
    r = client.get(f"/data/cubes/{slug}")
    assert r.status_code == 200
    payload = r.json()
    # the exact shape kubbar.js consumes
    assert payload["slug"] == slug
    assert {"n_events", "n_matches", "n_players", "first_played", "last_played"} <= set(payload["summary"])
    assert isinstance(payload["trophy_leaders"], list)
    assert isinstance(payload["player_rankings"], list)
    assert isinstance(payload["events"], list)
