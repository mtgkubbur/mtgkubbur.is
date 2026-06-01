from app import data


def test_meta_tiers_vocab():
    meta = data.load_meta()
    assert set(meta["tiers"]).issubset({"High", "Medium", "Low", "Other"})
    assert meta["n_players"] >= 1


def test_rankings_nonempty():
    assert len(data.load_rankings()) >= 1


def test_player_index_resolves_to_files():
    idx = data.player_index()
    assert len(idx) >= 1
    for p in idx:
        loaded = data.load_player(p["slug"])
        assert loaded is not None
        assert loaded["player"] == p["name"]


def test_player_index_icelandic_sorted():
    names = [p["name"] for p in data.player_index()]
    assert names == sorted(names, key=data.icelandic_sort_key)


def test_cube_index_resolves_to_files():
    idx = data.cube_index()
    assert len(idx) >= 1
    for c in idx:
        assert data.load_cube(c["slug"]) is not None


def test_icelandic_sort_key_orders_accents():
    assert data.icelandic_sort_key("á") > data.icelandic_sort_key("a")
    assert data.icelandic_sort_key("ö") > data.icelandic_sort_key("o")


def test_load_json_missing_returns_none(tmp_path):
    assert data.load_json(tmp_path / "nope.json") is None


def test_tier_maps():
    assert data.TIER_LABEL["Other"] == "Annað"
    assert data.TIER_COLOUR_VAR["High"] == "--mtg-red"
    assert data.healthz_ok() is True
