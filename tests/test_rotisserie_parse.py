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
        # Shape A: broken formulas ('#REF!'), the shape the parser was built against.
        ("Rotisserie Draft - Meta memories #REF! Binni", "Binni"),
        ("#REF! Örvar", "Örvar"),
        ("#REF! Aron Ívars.", "Aron Ívars."),
        # Shape B: repaired formulas, the name doubled instead of erroring.
        ("Örvar Örvar", "Örvar"),
        ("Aron Ívars. Aron Ívars.", "Aron Ívars."),
        ("Rotisserie Draft - Meta memories Binni Binni", "Binni"),
        # Unchanged behaviour: clean cells pass straight through.
        ("Binni", "Binni"),
        ("  Tommi  ", "Tommi"),
    ],
)
def test_clean_player_name(raw, expected):
    assert parse.clean_player_name(raw) == expected


def test_clean_player_name_does_not_over_collapse_a_doubled_two_word_name():
    """A two-word name doubled must collapse to itself, not to its last word."""
    result = parse.clean_player_name("Aron Ívars. Aron Ívars.")
    assert result == "Aron Ívars."
    assert result != "Ívars."


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


@pytest.mark.parametrize(
    ("card", "expected"),
    [
        # Live incident 2026-08-04: both Explore copies drafted as 'Explore 1'
        # and 'Explore 2' - names that exact-match validation rejects.
        ("Explore 1", "Explore"),
        ("Explore 2", "Explore"),
        # Exact cube names always pass through untouched.
        ("Explore", "Explore"),
        ("Lightning Bolt", "Lightning Bolt"),
        # A copy number beyond the listed count is an anomaly, not a pick.
        ("Explore 3", "Explore 3"),
        ("Explore 0", "Explore 0"),
        # A base name absent from the cube stays as-is for validate() to reject.
        ("Duress 1", "Duress 1"),
        # Numbering a card the cube lists once is anomalous - do not guess.
        ("Opt 1", "Opt 1"),
    ],
)
def test_normalise_card(card, expected):
    counts = {"Explore": 2, "Opt": 1, "Lightning Bolt": 1}
    assert parse.normalise_card(card, counts) == expected


def test_normalise_card_prefers_an_exact_cube_match():
    """A cube card whose real name ends in a number must never be stripped."""
    counts = {"Explore": 2, "Explore 1": 1}
    assert parse.normalise_card("Explore 1", counts) == "Explore 1"


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


def test_parse_grid_rejects_duplicate_player_names():
    """Two columns cleaning to the same name means the cleaning logic has failed again."""
    csv_text = '"","","Örvar Örvar","Örvar Örvar","",""\n"1","→","","",""\n'
    with pytest.raises(ValueError, match="duplicate player name") as excinfo:
        parse.parse_grid(csv_text)
    assert "Örvar Örvar" in str(excinfo.value)


def test_parse_grid_reads_the_live_doubled_name_header():
    """Shape B fixture: the sheet's formulas were repaired and now double the name."""
    grid = parse.parse_grid(_grid_text("draft_grid_doubled.csv"))
    assert grid.players == ("Binni", "Örvar", "Tommi", "Diddi", "Atli", "Óli", "Aron Ívars.", "Aron Freyr")


def test_digest_matches_between_shape_a_and_shape_b_headers():
    """Shape A (#REF!-broken) and shape B (doubled-name) headers must digest identically.

    state_digest only encodes the cleaned, normalised state, so a header-shape
    change alone (with identical picks) must not look like a change in the draft.
    """
    cube = parse.parse_cube_list(_cube_text())
    shape_a_digest = parse.state_digest(parse.parse_grid(_grid_text()), cube)

    shape_b_csv = _grid_text().replace(
        '"","","Rotisserie Draft - Meta memories #REF! Binni","#REF! Örvar","#REF! Tommi","#REF! Diddi",',
        '"","","Rotisserie Draft - Meta memories Binni Binni","Örvar Örvar","Tommi Tommi","Diddi Diddi",',
    )
    assert shape_b_csv != _grid_text()  # sanity: the replace actually matched
    shape_b_digest = parse.state_digest(parse.parse_grid(shape_b_csv), cube)

    assert shape_a_digest == shape_b_digest


def test_csv_url_shape():
    url = parse.csv_url(parse.GRID_GID)
    assert url.startswith("https://docs.google.com/spreadsheets/d/")
    assert "tqx=out:csv" in url
    assert f"gid={parse.GRID_GID}" in url
