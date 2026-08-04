"""Payload assembly, first_seen preservation, and the fail-loud invariants."""

from pathlib import Path

import pytest

from scripts import fetch_rotisserie as build
from scripts.rotisserie import parse

FIXTURES = Path(__file__).parent / "fixtures" / "rotisserie"
NOW = "2026-08-01T12:00:00Z"


def _grid(name: str = "draft_grid.csv") -> parse.DraftGrid:
    return parse.parse_grid((FIXTURES / name).read_text(encoding="utf-8"))


def _cube() -> list[str]:
    return parse.parse_cube_list((FIXTURES / "cube_list.csv").read_text(encoding="utf-8"))


def test_payload_core_counts():
    p = build.build_payload(_grid(), _cube(), previous=None, now=NOW)
    assert p["players"] == ["Binni", "Örvar", "Tommi", "Diddi"]
    assert p["rounds_total"] == 5
    assert p["picks_total"] == 20  # 5 rounds x 4 players
    assert p["picks_made"] == 6
    assert p["cube_size"] == 8  # 9 rows, Explore listed twice
    assert p["generated_at"] == NOW
    assert p["source_digest"].startswith("sha256:")


def test_pools_group_by_player():
    p = build.build_payload(_grid(), _cube(), previous=None, now=NOW)
    assert p["pools"]["Binni"] == ["Ragavan, Nimble Pilferer"]
    assert p["pools"]["Tommi"] == ["Thing in the Ice", "Path to Exile"]
    assert p["pools"]["Örvar"] == ["Brazen Borrower"]


def test_every_player_is_a_pool_key_even_with_no_picks():
    grid = parse.parse_grid(
        '"","","Binni","Örvar","","",""\n"1","→","","","","",""\n'
    )
    p = build.build_payload(grid, ["Lightning Bolt"], previous=None, now=NOW)
    assert p["pools"] == {"Binni": [], "Örvar": []}
    assert p["picks_made"] == 0
    assert p["next_player"] == "Binni"


def test_remaining_is_a_multiset_difference():
    """Explore is listed twice; drafting one copy must leave the other."""
    grid = parse.parse_grid('"","","Binni","",""\n"1","→","Explore","",""\n')
    p = build.build_payload(grid, _cube(), previous=None, now=NOW)
    assert p["remaining"].count("Explore") == 1
    assert "Ragavan, Nimble Pilferer" in p["remaining"]


def test_remaining_plus_pools_reconstitutes_the_cube():
    p = build.build_payload(_grid(), _cube(), previous=None, now=NOW)
    drafted = [c for pool in p["pools"].values() for c in pool]
    assert sorted(drafted + p["remaining"]) == sorted(_cube())


def test_log_is_reverse_chronological_with_seq():
    p = build.build_payload(_grid(), _cube(), previous=None, now=NOW)
    assert [e["seq"] for e in p["log"]] == [6, 5, 4, 3, 2, 1]
    assert p["log"][0]["player"] == "Tommi"
    assert p["log"][0]["card"] == "Path to Exile"
    assert p["log"][-1]["card"] == "Ragavan, Nimble Pilferer"


def test_first_seen_is_preserved_for_known_picks_and_stamped_for_new_ones():
    earlier = build.build_payload(_grid(), _cube(), previous=None, now="2026-07-01T00:00:00Z")
    bumped = parse.parse_grid(
        (FIXTURES / "draft_grid.csv")
        .read_text(encoding="utf-8")
        .replace('"2","↪","","","Path to Exile"', '"2","↪","","Wrath of God","Path to Exile"')
    )
    later = build.build_payload(bumped, _cube(), previous=earlier, now=NOW)
    by_card = {e["card"]: e["first_seen"] for e in later["log"]}
    assert by_card["Ragavan, Nimble Pilferer"] == "2026-07-01T00:00:00Z"
    assert by_card["Wrath of God"] == NOW


def test_first_seen_is_stamped_fresh_for_a_second_same_named_pick():
    """The cube lists Explore twice. If Binni drafts both copies across two
    runs, the second pick's identity is its cell (round 2), not its card
    name - it must get its own timestamp, not inherit round 1's."""
    cube = ["Explore", "Explore"]
    grid1 = parse.parse_grid('"","","Binni","",""\n"1","→","Explore","",""\n"2","↪","","",""\n')
    earlier = build.build_payload(grid1, cube, previous=None, now="2026-07-01T00:00:00Z")

    grid2 = parse.parse_grid('"","","Binni","",""\n"1","→","Explore","",""\n"2","↪","Explore","",""\n')
    later = build.build_payload(grid2, cube, previous=earlier, now=NOW)

    by_round = {e["round"]: e["first_seen"] for e in later["log"]}
    assert by_round[1] == "2026-07-01T00:00:00Z"
    assert by_round[2] == NOW


def test_numbered_duplicate_picks_normalise_and_validate():
    """Live incident 2026-08-04: Diddi drafted both Explores as 'Explore 1'
    and 'Explore 2'. The build must fold them onto the cube's name so the
    pools, remaining pool, and validation all see 'Explore'."""
    cube = ["Explore", "Explore"]
    grid = parse.parse_grid('"","","Binni","",""\n"1","→","Explore 1","",""\n"2","↪","Explore 2","",""\n')
    p = build.build_payload(grid, cube, previous=None, now=NOW)
    assert p["pools"]["Binni"] == ["Explore", "Explore"]
    assert p["remaining"] == []
    build.validate(p, cube, previous=None)


def test_numbered_duplicate_pick_first_seen_is_stable_across_runs():
    """The raw cell keeps saying 'Explore 1'; the committed log says
    'Explore'. Re-running must treat them as the same pick."""
    cube = ["Explore", "Explore"]
    grid = parse.parse_grid('"","","Binni","",""\n"1","→","Explore 1","",""\n')
    earlier = build.build_payload(grid, cube, previous=None, now="2026-07-01T00:00:00Z")
    later = build.build_payload(grid, cube, previous=earlier, now=NOW)
    [entry] = later["log"]
    assert entry["card"] == "Explore"
    assert entry["first_seen"] == "2026-07-01T00:00:00Z"


def test_first_seen_is_preserved_when_a_cells_card_is_unchanged():
    cube = ["Explore", "Explore"]
    grid = parse.parse_grid('"","","Binni","",""\n"1","→","Explore","",""\n')
    earlier = build.build_payload(grid, cube, previous=None, now="2026-07-01T00:00:00Z")
    later = build.build_payload(grid, cube, previous=earlier, now=NOW)
    [entry] = later["log"]
    assert entry["first_seen"] == "2026-07-01T00:00:00Z"


def test_first_seen_is_refreshed_when_a_cells_card_changes():
    """A cell whose card was edited is a different pick and gets a fresh
    first_seen, even though it is the same (round, player) cell."""
    cube = ["Ragavan, Nimble Pilferer", "Wrath of God"]
    grid1 = parse.parse_grid('"","","Binni","",""\n"1","→","Ragavan, Nimble Pilferer","",""\n')
    earlier = build.build_payload(grid1, cube, previous=None, now="2026-07-01T00:00:00Z")

    grid2 = parse.parse_grid('"","","Binni","",""\n"1","→","Wrath of God","",""\n')
    later = build.build_payload(grid2, cube, previous=earlier, now=NOW)
    [entry] = later["log"]
    assert entry["card"] == "Wrath of God"
    assert entry["first_seen"] == NOW


def test_next_player_follows_the_snake():
    p = build.build_payload(_grid(), _cube(), previous=None, now=NOW)
    # 6 picks in: round 2 has Diddi and Tommi done, so Örvar is next (reversed round)
    assert p["next_player"] == "Örvar"
    assert p["current_round"] == 2


def test_next_player_is_none_when_the_draft_is_complete():
    full = '"","","Binni","Örvar","",""\n"1","→","A","B","",""\n"2","↪","C","D","",""\n'
    p = build.build_payload(parse.parse_grid(full), ["A", "B", "C", "D"], previous=None, now=NOW)
    assert p["picks_made"] == 4
    assert p["next_player"] is None


def test_validate_accepts_a_good_payload():
    cube = _cube()
    build.validate(build.build_payload(_grid(), cube, previous=None, now=NOW), cube, previous=None)


def test_validate_rejects_a_card_outside_the_cube():
    cube = _cube()
    p = build.build_payload(_grid(), cube, previous=None, now=NOW)
    p["pools"]["Binni"] = ["Black Lotus"]
    with pytest.raises(ValueError, match="not in the cube"):
        build.validate(p, cube, previous=None)


def test_validate_rejects_over_drafting_a_duplicate():
    cube = _cube()  # Explore x2
    p = build.build_payload(_grid(), cube, previous=None, now=NOW)
    p["pools"]["Binni"] = ["Explore", "Explore"]
    p["pools"]["Örvar"] = ["Explore"]
    with pytest.raises(ValueError, match="drafted 3 time"):
        build.validate(p, cube, previous=None)


def test_validate_rejects_a_retracted_pick():
    cube = _cube()
    previous = build.build_payload(_grid(), cube, previous=None, now=NOW)
    shrunk = parse.parse_grid(
        (FIXTURES / "draft_grid.csv")
        .read_text(encoding="utf-8")
        .replace('"Ragavan, Nimble Pilferer"', '""')
    )
    p = build.build_payload(shrunk, cube, previous=previous, now=NOW)
    with pytest.raises(ValueError, match="disappeared"):
        build.validate(p, cube, previous=previous)


def test_validate_rejects_a_retraction_hidden_behind_a_duplicate_card_name():
    """Two picks share a card name (Explore x2 in the cube). Deleting one of
    them must not be masked by the other still being present in the set of
    (player, card) pairs."""
    cube = ["Explore", "Explore"]
    grid_both = parse.parse_grid('"","","Binni","",""\n"1","→","Explore","",""\n"2","↪","Explore","",""\n')
    previous = build.build_payload(grid_both, cube, previous=None, now=NOW)

    grid_one = parse.parse_grid('"","","Binni","",""\n"1","→","Explore","",""\n"2","↪","","",""\n')
    p = build.build_payload(grid_one, cube, previous=previous, now=NOW)
    with pytest.raises(ValueError, match="disappeared"):
        build.validate(p, cube, previous=previous)


def test_validate_rejects_a_mutated_pick_with_a_message_distinct_from_retraction():
    """A cell whose card changed (not disappeared) is a different anomaly
    from a retraction and must be reported as such."""
    cube = ["Ragavan, Nimble Pilferer", "Wrath of God"]
    grid1 = parse.parse_grid('"","","Binni","",""\n"1","→","Ragavan, Nimble Pilferer","",""\n')
    previous = build.build_payload(grid1, cube, previous=None, now=NOW)

    grid2 = parse.parse_grid('"","","Binni","",""\n"1","→","Wrath of God","",""\n')
    p = build.build_payload(grid2, cube, previous=previous, now=NOW)
    with pytest.raises(ValueError, match="mutat") as excinfo:
        build.validate(p, cube, previous=previous)
    assert "disappeared" not in str(excinfo.value)


def test_validate_rejects_a_shrinking_player_list():
    cube = _cube()
    previous = build.build_payload(_grid(), cube, previous=None, now=NOW)
    p = build.build_payload(_grid(), cube, previous=previous, now=NOW)
    p["players"] = ["Binni", "Örvar"]
    p["pools"] = {"Binni": p["pools"]["Binni"], "Örvar": p["pools"]["Örvar"]}
    with pytest.raises(ValueError, match="player set changed"):
        build.validate(p, cube, previous=previous)


def test_load_returns_none_for_an_absent_file(tmp_path):
    missing = tmp_path / "rotisserie.json"
    assert build._load(missing) is None


def test_load_raises_for_a_present_but_malformed_file(tmp_path):
    """A corrupt-but-present file must abort the build, not be treated like a
    legitimate first run - it is the only safety baseline validate() has."""
    corrupt = tmp_path / "rotisserie.json"
    corrupt.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(ValueError):
        build._load(corrupt)
