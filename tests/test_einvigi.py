from fastapi.testclient import TestClient

from app import data
from app.main import app

client = TestClient(app)


def test_einvigi_200():
    r = client.get("/einvigi")
    assert r.status_code == 200


def test_einvigi_has_header_and_pickers():
    html = client.get("/einvigi").text
    # mana hero title + desc (from strings)
    assert "Einvígi" in html
    assert "Beinn samanburður milli tveggja leikmanna" in html
    # two player selects with verbatim labels + placeholder
    assert "Leikmaður 1:" in html
    assert "Leikmaður 2:" in html
    assert html.count("Veldu leikmann...") >= 2
    # the two-picker wrapper + mount points
    assert 'id="player-selectors"' in html
    assert 'class="h2h-layout"' in html


def test_einvigi_options_are_player_slugs():
    html = client.get("/einvigi").text
    # every player slug appears as an <option value="...">
    for p in data.player_index():
        assert f'value="{p["slug"]}"' in html
        assert f">{p['name']}</option>" in html


def test_einvigi_active_nav():
    html = client.get("/einvigi").text
    # the active nav link is the Einvígi one (page == "einvigi")
    assert '<a class="nav-link active" href="/einvigi">Einvígi</a>' in html
