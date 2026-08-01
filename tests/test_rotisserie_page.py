"""The rotisserie page renders, is unlisted, and is excluded from search engines."""

import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.strings import STRINGS

client = TestClient(app)
S = STRINGS["is"]

# Path to the rotisserie template
TEMPLATE_PATH = Path(__file__).parent.parent / "app" / "templates" / "rotisserie.html"


def test_page_renders():
    r = client.get("/rotisserie")
    assert r.status_code == 200
    assert S["rotisserie_title"] in r.text


def test_page_is_noindex():
    r = client.get("/rotisserie")
    # Extract <head> section
    head_match = re.search(r"<head[^>]*>(.*?)</head>", r.text, re.DOTALL)
    assert head_match, "No <head> section found"
    head_content = head_match.group(1)
    assert '<meta name="robots" content="noindex' in head_content


def test_page_is_absent_from_every_nav():
    """Unlisted means unlinked: no page may link to it, including itself."""
    for path in ("/", "/throun", "/einvigi", "/kubbar", "/dagatal", "/methods", "/rotisserie"):
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


def test_rotisserie_strings_not_hard_coded():
    """
    Every user-visible string must be referenced via {{ S.<key> }} in the template source.
    Asserts that: (1) each rotisserie_* key is used via S.<key> in the template, and
    (2) the literal string value does not appear anywhere in the template source.
    """
    template_source = TEMPLATE_PATH.read_text(encoding="utf-8")

    # Extract all {{ S.rotisserie_* }} patterns from the template
    pattern = r"\{\{\s*S\.rotisserie_(\w+)\s*\}\}"
    used_keys = set(re.findall(pattern, template_source))

    assert used_keys, "No rotisserie_* strings found in template"

    for key in used_keys:
        full_key = f"rotisserie_{key}"
        assert full_key in S, f"Key {full_key} not found in strings.py"

        # The literal value should NOT appear in the template source
        string_value = S[full_key]
        assert string_value not in template_source, (
            f"String value '{string_value}' for key '{full_key}' appears literally in template; "
            f"must use {{{{ S.{full_key} }}}}"
        )
