from app import data


def opted_in_names() -> set[str]:
    # rankings.json is the opted-in player set (Plan A filters at the publish boundary).
    return {r["player"] for r in data.load_rankings()}


def all_player_stat_names() -> set[str]:
    names: set[str] = set()
    names |= opted_in_names()
    for p in data.player_index():
        pl = data.load_player(p["slug"]) or {}
        if pl.get("player"):
            names.add(pl["player"])
    for h in data.load_head_to_head():
        names.add(h["player_a"])
        names.add(h["player_b"])
    for c in data.cube_index():
        cd = data.load_cube(c["slug"]) or {}
        for t in cd.get("trophy_leaders", []):
            names.add(t["player"])
        for pr in cd.get("player_rankings", []):
            names.add(pr["player"])
        for ev in cd.get("events", []):
            for res in ev.get("results", []):
                names.add(res["player"])
    return names


def test_no_unknown_player_in_stats():
    # Every player-stat name must be an opted-in player. (calendar host is exempt/public.)
    unknown = all_player_stat_names() - opted_in_names()
    assert unknown == set(), f"non-opted-in names leaked into player stats: {unknown}"


def test_sentinel_not_present():
    assert "Zzz" not in all_player_stat_names()
