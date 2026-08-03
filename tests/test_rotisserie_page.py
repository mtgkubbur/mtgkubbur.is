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

# Jinja syntax to strip when isolating the literal text a template author
# actually typed by hand: {{ expr }}, {% tag %}, {# comment #}.
_JINJA_SYNTAX = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}", re.DOTALL)

# Keys this template is known to render server-side via {{ S.<key> }}. This is
# the only hard-coded key list in this file, and it exists purely for the
# "did a reference silently vanish" check in test_rotisserie_strings_not_hard_coded
# -- it is deliberately not reused as that test's "must not be hard-coded" key
# list, because a list scanned/fixed from the template under audit is exactly
# what made the previous version of this test circular.
RENDERED_KEYS = {
    "rotisserie_title",
    "rotisserie_pools",
    "rotisserie_remaining",
    "rotisserie_search",
    "rotisserie_type_all",
    "rotisserie_log",
    "rotisserie_order_label",
    "rotisserie_cmc_label",
    "rotisserie_clear",
}

# Below this length a string value (e.g. rotisserie_of == "af") is likely to
# occur as a substring of an unrelated word, class name, or attribute rather
# than as the copy itself appearing hard-coded. Checked and false-positive-free
# against the current template; kept as a documented, principled cut-off
# rather than an ad hoc per-key exclusion so it still holds as the template
# grows and picks up more short connector words.
MIN_LITERAL_CHECK_LENGTH = 4


def _stripped_template_text() -> str:
    """Template source with Jinja syntax removed, leaving only the literal
    markup/text the template author wrote by hand."""
    return _JINJA_SYNTAX.sub("", TEMPLATE_PATH.read_text(encoding="utf-8"))


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
        'id="rot-pool-order"',
        'id="rot-remaining"',
        'id="rot-log"',
        'id="rot-search"',
        'id="rot-colour-filters"',
        'id="rot-cmc-filters"',
        'id="rot-type-filter"',
        'id="rot-sort"',
        'id="rot-clear"',
        'id="rot-lightbox"',
    ):
        assert token in body, token


def test_page_loads_its_module():
    assert "/static/js/rotisserie.js" in client.get("/rotisserie").text


def test_rotisserie_strings_not_hard_coded():
    """
    Every user-visible string on the rotisserie page must come from app/strings.py
    via {{ S.<key> }}, never hard-coded literally in the template.

    The key list for the "not hard-coded" half is derived from STRINGS itself --
    never from scanning the template -- because scanning the template for
    {{ S.key }} usages and then only checking those keys is circular: the
    regression this test exists to catch (swapping a reference for its literal
    value) also removes that key from the scanned list, so the check silently
    stops covering the exact string it should be watching. STRINGS is the
    ground truth of what copy exists; the template is only ever the thing
    under audit, never the source of what to check.
    """
    stripped = _stripped_template_text()

    # rotisserie_ / colour_ / type_ keys are the user-visible copy this page
    # (server template plus its client JS, both fed from the same STRINGS
    # table) is built from. Filtering by prefix rather than naming individual
    # keys means new copy added under these prefixes is automatically
    # covered, so the check can't drift out of date as the template grows.
    candidate_keys = [
        key
        for key in S
        if key.startswith(("rotisserie_", "colour_", "type_")) and len(S[key]) >= MIN_LITERAL_CHECK_LENGTH
    ]
    assert candidate_keys, "No rotisserie_*/colour_*/type_* strings found in STRINGS"

    for key in candidate_keys:
        value = S[key]
        assert value not in stripped, (
            f"String value '{value}' for key '{key}' appears literally in rotisserie.html; "
            f"must use {{{{ S.{key} }}}} instead"
        )

    # Positive half: a reference can also disappear without being replaced by
    # a literal (the surrounding markup is simply deleted), which the check
    # above cannot detect. Assert the keys the page is known to render are
    # still referenced as S.<key> in the raw (unstripped) source.
    raw_source = TEMPLATE_PATH.read_text(encoding="utf-8")
    for key in RENDERED_KEYS:
        assert key in S, f"Key {key} not found in strings.py"
        assert f"S.{key}" in raw_source, f"Expected {{{{ S.{key} }}}} reference not found in rotisserie.html"
