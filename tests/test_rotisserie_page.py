"""The rotisserie page renders, is unlisted, and is excluded from search engines."""

from fastapi.testclient import TestClient

from app.main import app
from app.strings import STRINGS

client = TestClient(app)
S = STRINGS["is"]


def test_page_renders():
    r = client.get("/rotisserie")
    assert r.status_code == 200
    assert S["rotisserie_title"] in r.text


def test_page_is_noindex():
    r = client.get("/rotisserie")
    assert '<meta name="robots" content="noindex' in r.text


def test_page_is_absent_from_every_nav():
    """Unlisted means unlinked: no page may link to it, including itself."""
    for path in ("/", "/throun", "/einvigi", "/kubbar", "/dagatal", "/rotisserie"):
        body = client.get(path).text
        assert 'href="/rotisserie"' not in body, path


def test_page_has_the_mount_points_the_js_targets():
    body = client.get("/rotisserie").text
    for token in (
        'id="rot-status"',
        'id="rot-pools"',
        'id="rot-remaining"',
        'id="rot-log"',
        'id="rot-search"',
        'id="rot-colour-filters"',
        'id="rot-type-filter"',
        'id="rot-lightbox"',
    ):
        assert token in body, token


def test_page_loads_its_module():
    assert "/static/js/rotisserie.js" in client.get("/rotisserie").text


def test_no_user_visible_copy_is_hard_coded():
    """Every heading must come from strings.py, per the site's copy convention."""
    body = client.get("/rotisserie").text
    for key in ("rotisserie_title", "rotisserie_pools", "rotisserie_remaining", "rotisserie_log"):
        assert S[key] in body, key
