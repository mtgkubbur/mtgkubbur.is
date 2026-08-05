"""The deckbuilder subpage renders, is unlisted, and interlinks only with its parent.

Unlisted policy for the rotisserie pair: no public page links to either
/rotisserie or /rotisserie/deck; the two unlisted pages MAY link to each
other (a visitor is already inside the unlisted zone). The parent page's
test_page_is_absent_from_every_nav keeps its stricter public-nav sweep.
"""

import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.strings import STRINGS

client = TestClient(app)
S = STRINGS["is"]

TEMPLATE_PATH = Path(__file__).parent.parent / "app" / "templates" / "rotisserie_deck.html"

_JINJA_SYNTAX = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}", re.DOTALL)

PUBLIC_PATHS = ("/", "/throun", "/einvigi", "/kubbar", "/dagatal", "/methods")


def test_page_renders():
    r = client.get("/rotisserie/deck")
    assert r.status_code == 200
    assert S["rotisserie_deck_title"] in r.text


def test_page_is_noindex():
    r = client.get("/rotisserie/deck")
    head_match = re.search(r"<head[^>]*>(.*?)</head>", r.text, re.DOTALL)
    assert head_match, "No <head> section found"
    assert '<meta name="robots" content="noindex' in head_match.group(1)


def test_page_is_absent_from_every_public_nav():
    for path in PUBLIC_PATHS:
        body = client.get(path).text
        assert 'href="/rotisserie/deck"' not in body, path


def test_parent_page_links_here_and_back():
    assert 'href="/rotisserie/deck"' in client.get("/rotisserie").text
    assert 'href="/rotisserie"' in client.get("/rotisserie/deck").text


def test_page_has_the_mount_points_the_js_targets():
    body = client.get("/rotisserie/deck").text
    for token in (
        'id="rd-player"',
        'id="rd-counts"',
        'id="rd-mana"',
        'id="rd-export"',
        'id="rd-reset"',
        'id="rd-columns"',
        'id="rd-side"',
        'id="rd-available"',
        'id="rd-search"',
        'id="rd-colour-filters"',
        'id="rd-cmc-filters"',
        'id="rd-type-filter"',
        'id="rd-clear"',
        'id="rd-popover"',
        'id="rot-lightbox"',
    ):
        assert token in body, token


def test_page_loads_its_module():
    assert "/static/js/rotisserie-deck.js" in client.get("/rotisserie/deck").text


def test_deck_strings_not_hard_coded():
    """Same audit as the parent page's, against this template: every
    rotisserie_/colour_/type_ string must arrive via {{ S.<key> }}."""
    stripped = _JINJA_SYNTAX.sub("", TEMPLATE_PATH.read_text(encoding="utf-8"))
    candidate_keys = [
        key for key in S if key.startswith(("rotisserie_", "colour_", "type_")) and len(S[key]) >= 4
    ]
    assert candidate_keys
    for key in candidate_keys:
        assert S[key] not in stripped, (
            f"String value '{S[key]}' for key '{key}' appears literally in "
            f"rotisserie_deck.html; must use {{{{ S.{key} }}}} instead"
        )
