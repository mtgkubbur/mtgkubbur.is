import json

from app.strings import STRINGS, strings_json


def test_is_present():
    s = STRINGS["is"]
    assert s["brand"] == "MtG Kubbur"
    assert s["nav_leikmadur"] == "Leikmaður"
    assert s["filter_other"] == "Annað"
    assert s["chart_strength_title"] == "Kubbastyrkur yfir tíma"
    assert s["axis_strength"] == "Kubbaáhrif (γ)"
    assert "{p1}" in s["no_games"] and "{p2}" in s["no_games"]


def test_strings_json_roundtrips_unicode():
    parsed = json.loads(strings_json())
    assert parsed["legend_median"] == "Miðgildi"
    # ensure_ascii=False kept the accented chars literal
    assert "\\u" not in strings_json()
