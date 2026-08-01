"""Sheet parsing: header cleaning, snake ordering, and a churn-immune digest."""

from pathlib import Path

import pytest

from scripts.rotisserie import parse

FIXTURES = Path(__file__).parent / "fixtures" / "rotisserie"


def _grid_text(name: str = "draft_grid.csv") -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _cube_text() -> str:
    return (FIXTURES / "cube_list.csv").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Rotisserie Draft - Meta memories #REF! Binni", "Binni"),
        ("#REF! Örvar", "Örvar"),
        ("#REF! Aron Ívars.", "Aron Ívars."),
        ("Binni", "Binni"),
        ("  Tommi  ", "Tommi"),
    ],
)
def test_clean_player_name(raw, expected):
    assert parse.clean_player_name(raw) == expected


def test_parse_grid_players_and_shape():
    grid = parse.parse_grid(_grid_text())
    assert grid.players == ("Binni", "Örvar", "Tommi", "Diddi")
    assert grid.rounds_total == 5
    assert len(grid.cells) == 5
    assert grid.cells[0] == ("Ragavan, Nimble Pilferer", "Brazen Borrower", "Thing in the Ice", "Lightning Bolt")
    assert grid.cells[1] == ("", "", "Path to Exile", "Counterspell")
    assert grid.cells[4] == ("", "", "", "")


def test_pick_sequence_follows_the_snake():
    picks = parse.pick_sequence(parse.parse_grid(_grid_text()))
    assert [(p.seq, p.round, p.player, p.card) for p in picks] == [
        (1, 1, "Binni", "Ragavan, Nimble Pilferer"),
        (2, 1, "Örvar", "Brazen Borrower"),
        (3, 1, "Tommi", "Thing in the Ice"),
        (4, 1, "Diddi", "Lightning Bolt"),
        # round 2 runs right-to-left
        (5, 2, "Diddi", "Counterspell"),
        (6, 2, "Tommi", "Path to Exile"),
    ]


def test_parse_cube_list_keeps_duplicates_in_order():
    names = parse.parse_cube_list(_cube_text())
    assert len(names) == 9
    assert names[0] == "Ragavan, Nimble Pilferer"
    assert names.count("Explore") == 2


def test_digest_is_stable_for_identical_input():
    grid = parse.parse_grid(_grid_text())
    cube = parse.parse_cube_list(_cube_text())
    assert parse.state_digest(grid, cube) == parse.state_digest(grid, cube)
    assert parse.state_digest(grid, cube).startswith("sha256:")


def test_digest_ignores_ref_churn_in_status_cells_and_headers():
    """The motivating case: repairing #REF! must not look like a pick."""
    cube = parse.parse_cube_list(_cube_text())
    before = parse.state_digest(parse.parse_grid(_grid_text()), cube)
    after = parse.state_digest(parse.parse_grid(_grid_text("draft_grid_refchurn.csv")), cube)
    assert before == after


def test_digest_changes_when_a_pick_is_made():
    cube = parse.parse_cube_list(_cube_text())
    before = parse.state_digest(parse.parse_grid(_grid_text()), cube)
    bumped = _grid_text().replace(
        '"2","↪","","","Path to Exile"', '"2","↪","","Wrath of God","Path to Exile"'
    )
    after = parse.state_digest(parse.parse_grid(bumped), cube)
    assert before != after


def test_digest_changes_when_the_cube_list_changes():
    grid = parse.parse_grid(_grid_text())
    cube = parse.parse_cube_list(_cube_text())
    assert parse.state_digest(grid, cube) != parse.state_digest(grid, [*cube, "Swords to Plowshares"])


def test_parse_grid_rejects_a_header_with_no_players():
    with pytest.raises(ValueError, match="no player columns"):
        parse.parse_grid('"","","","",""\n"1","→","","","",""\n')


def test_parse_grid_rejects_an_uncleanable_header():
    with pytest.raises(ValueError, match="unparsable player name"):
        parse.parse_grid('"","","#REF!","",""\n"1","→","","",""\n')


def test_csv_url_shape():
    url = parse.csv_url(parse.GRID_GID)
    assert url.startswith("https://docs.google.com/spreadsheets/d/")
    assert "tqx=out:csv" in url
    assert f"gid={parse.GRID_GID}" in url
