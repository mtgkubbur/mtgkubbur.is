# Rotisserie Draft Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an unlisted `/rotisserie` page on mtgkubbur.is showing the live state of the Meta Memories rotisserie draft — draft status, each player's picked cards as Scryfall images, the undrafted pool, and the pick log.

**Architecture:** A two-job GitHub Action polls the sheet's public CSV endpoints every two hours. A stdlib-only gate job digests the parsed pick state and exits unless it differs from the committed JSON; only then does a sync job rebuild `rotisserie.json` + `rotisserie_cards.json`, validate, commit, and deploy. The FastAPI app never talks to Google or Scryfall — it serves committed JSON through `/data/rotisserie`, and the browser renders it.

**Tech Stack:** Python 3.12 (stdlib `csv`/`urllib`/`hashlib` for the pipeline), FastAPI + Jinja2, vanilla ES modules + vendored Alpine 3.14.8, `fastjsonschema` for publish validation, GitHub Actions, Fly.

**Spec:** `docs/superpowers/specs/2026-08-01-rotisserie-draft-page-design.md`

## Global Constraints

- **No new runtime or dev dependencies.** `pyproject.toml` pins `[tool.uv] exclude-newer = "2026-05-02"`; adding packages is out of scope. The pipeline uses only the standard library. `fastjsonschema` (already in the `data` extra) is the sole exception, used only by `validate_publish.py`.
- **`scripts/rotisserie/parse.py` must import nothing outside the standard library.** The gate job runs it with the runner's preinstalled `python3` — no `setup-uv`, no `uv sync`. Importing `fastapi`, `app.*`, or anything third-party breaks the gate.
- Python `>=3.12`. Ruff: `line-length = 120`, `select = ["E", "F", "I", "N", "W", "UP"]`.
- All UI copy lives in `app/strings.py` under `STRINGS["is"]`. Icelandic only. No user-visible string may be hard-coded in a template or JS file.
- Dark mode is `[data-theme]` + CSS custom properties, **never** Tailwind `dark:`.
- New CSS goes in `app/static/css/mtg.css` (not Tailwind-processed). Bump the `?v=N` query on the `mtg.css` link in `app/templates/base.html` when shipping visual changes.
- `data.py` access is fail-soft: missing or malformed JSON yields `None`/`[]`/`{}` and logs — never raises.
- Pipeline scripts are the opposite: fail-loud. Invalid source data exits non-zero.
- British spelling in prose and comments.
- Tests run with `uv run --extra dev --extra data pytest tests/ -q`. Lint with `uv run --extra dev ruff check .`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never run bare `git` from the parent `MagicTheGathering/` directory; a pre-commit hook blocks it. Work inside `mtgkubbur.is/`.

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `scripts/rotisserie/__init__.py` | Package marker |
| `scripts/rotisserie/parse.py` | Stdlib-only: fetch CSVs, parse both tabs, snake ordering, state digest |
| `scripts/rotisserie/scryfall.py` | Card-cache builder: batch collection, alias index, face-image flattening |
| `scripts/rotisserie_changed.py` | Gate entrypoint; writes `changed=true|false` to `$GITHUB_OUTPUT` |
| `scripts/fetch_rotisserie.py` | Sync entrypoint; builds, validates and writes both JSON files |
| `data/kubbur-schemas/rotisserie.schema.json` | Publish-gate schema for the draft state |
| `data/kubbur-schemas/rotisserie_cards.schema.json` | Publish-gate schema for the card cache |
| `app/routes/rotisserie.py` | `GET /rotisserie` shell route |
| `app/templates/rotisserie.html` | Page shell with mount points + `noindex` |
| `app/static/js/rotisserie.js` | Fetch `/data/rotisserie`, render all four sections |
| `.github/workflows/rotisserie.yml` | Two-hourly gate + sync + deploy |
| `tests/fixtures/rotisserie/*.csv`, `cards_sample.json` | Deterministic offline fixtures |
| `tests/test_rotisserie_parse.py` | Parser + snake order + digest |
| `tests/test_rotisserie_build.py` | Payload assembly, `first_seen`, fail-loud validation |
| `tests/test_rotisserie_cards.py` | Alias index + face-image flattening |
| `tests/test_rotisserie_page.py` | Route, `noindex`, nav absence, `/data/rotisserie` |

**Modified:** `app/data.py`, `app/routes/data_api.py`, `app/main.py`, `app/strings.py`, `app/static/css/mtg.css`, `app/templates/base.html`, `scripts/validate_publish.py`.

---

### Task 1: Sheet parser (stdlib only)

**Files:**
- Create: `scripts/rotisserie/__init__.py`, `scripts/rotisserie/parse.py`
- Create: `tests/fixtures/rotisserie/draft_grid.csv`, `tests/fixtures/rotisserie/draft_grid_refchurn.csv`, `tests/fixtures/rotisserie/cube_list.csv`
- Test: `tests/test_rotisserie_parse.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `SHEET_ID`, `GRID_GID`, `LIST_GID`, `csv_url(gid: str, sheet_id: str = SHEET_ID) -> str`, `fetch_csv(url: str, timeout: int = 30) -> str`, `clean_player_name(raw: str) -> str`, `parse_grid(csv_text: str) -> DraftGrid`, `parse_cube_list(csv_text: str) -> list[str]`, `pick_sequence(grid: DraftGrid) -> list[Pick]`, `state_digest(grid: DraftGrid, cube_names: Sequence[str]) -> str`. Dataclasses `Pick(round: int, seq: int, player: str, card: str)` and `DraftGrid(players: tuple[str, ...], rounds_total: int, cells: tuple[tuple[str, ...], ...])`.

- [ ] **Step 1: Create the fixture directory and the three CSV fixtures**

These mirror the real sheet's quirks exactly — fully quoted fields, `#REF!`-prefixed headers, the sheet title bleeding into the first player cell, snake arrows, and a `#REF!` status block off to the right. Four players and five rounds keep assertions readable.

```bash
mkdir -p tests/fixtures/rotisserie scripts/rotisserie
```

`tests/fixtures/rotisserie/draft_grid.csv`:

```csv
"","","Rotisserie Draft - Meta memories #REF! Binni","#REF! Örvar","#REF! Tommi","#REF! Diddi","","","","Draft Status",""
"1","→","Ragavan, Nimble Pilferer","Brazen Borrower","Thing in the Ice","Lightning Bolt","↩","","","Players:","#REF!"
"2","↪","","","Path to Exile","Counterspell","","","","Round Number:","#REF!"
"3","","","","","","↩","","","Draft Active:","#REF!"
"4","↪","","","","","","","","",""
"5","","","","","","↩","","","",""
```

`tests/fixtures/rotisserie/draft_grid_refchurn.csv` — identical picks, but the status block has been repaired and the header `#REF!` prefixes are gone. The digest must be unchanged:

```csv
"","","Binni","Örvar","Tommi","Diddi","","","","Draft Status",""
"1","→","Ragavan, Nimble Pilferer","Brazen Borrower","Thing in the Ice","Lightning Bolt","↩","","","Players:","4"
"2","↪","","","Path to Exile","Counterspell","","","","Round Number:","2"
"3","","","","","","↩","","","Draft Active:","TRUE"
"4","↪","","","","","","","","",""
"5","","","","","","↩","","","",""
```

`tests/fixtures/rotisserie/cube_list.csv` — note `Explore` twice, mirroring the real 540-rows/539-names duplicate:

```csv
"✓","Card","Type","Color","View","Picked By",""
"","Ragavan, Nimble Pilferer","","","View","Binni",""
"","Brazen Borrower","","","View","",""
"","Thing in the Ice","","","View","",""
"","Lightning Bolt","","","View","",""
"","Path to Exile","","","View","",""
"","Counterspell","","","View","",""
"","Explore","","","View","",""
"","Explore","","","View","",""
"","Wrath of God","","","View","",""
```

- [ ] **Step 2: Write the failing tests**

`tests/test_rotisserie_parse.py`:

```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run --extra dev pytest tests/test_rotisserie_parse.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'scripts.rotisserie'`.

- [ ] **Step 4: Implement the parser**

`scripts/rotisserie/__init__.py`:

```python
"""Rotisserie draft pipeline helpers. Standard library only — see plan Global Constraints."""
```

`scripts/rotisserie/parse.py`:

```python
"""Parse the rotisserie Google Sheet.

Standard library only: the GitHub Actions gate job runs this with the runner's
preinstalled python3, with no dependency installation at all. Do not add imports
outside the stdlib.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass

SHEET_ID = "1UlGvtJ1Lqzm6XodeSNr5vkvicIsqJAPwwjyRXAqR4XQ"
GRID_GID = "1822506900"
LIST_GID = "0"

USER_AGENT = "mtgkubbur.is/0.1 (+https://mtgkubbur.is; rotisserie draft page)"

# Column layout of the draft grid, verified 2026-08-01.
_ROUND_COL = 0
_FIRST_PLAYER_COL = 2
# Column layout of the cube list.
_CARD_COL = 1

_MAX_PLAYER_NAME = 40


@dataclass(frozen=True)
class Pick:
    round: int
    seq: int
    player: str
    card: str


@dataclass(frozen=True)
class DraftGrid:
    players: tuple[str, ...]
    rounds_total: int
    cells: tuple[tuple[str, ...], ...]  # cells[round_index][player_index]


def csv_url(gid: str, sheet_id: str = SHEET_ID) -> str:
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&gid={gid}"


def fetch_csv(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https host
        return resp.read().decode("utf-8")


def clean_player_name(raw: str) -> str:
    """Strip the broken-formula and merged-title prefixes off a header cell.

    The live sheet yields '#REF! Örvar', and for the first column the merged
    sheet title bleeds in too: 'Rotisserie Draft - Meta memories #REF! Binni'.
    A repaired sheet yields a bare name, which must pass through untouched.
    """
    text = raw.strip()
    marker = "#REF!"
    if marker in text:
        text = text.rsplit(marker, 1)[1]
    return text.strip()


def _rows(csv_text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(csv_text)))


def parse_grid(csv_text: str) -> DraftGrid:
    rows = _rows(csv_text)
    if not rows:
        raise ValueError("draft grid: empty CSV")

    header = rows[0]
    raw_names: list[str] = []
    for col in range(_FIRST_PLAYER_COL, len(header)):
        if not header[col].strip():
            break
        raw_names.append(header[col])
    if not raw_names:
        raise ValueError("draft grid: no player columns found in header row")

    players: list[str] = []
    for raw in raw_names:
        name = clean_player_name(raw)
        if not name or len(name) > _MAX_PLAYER_NAME:
            raise ValueError(f"draft grid: unparsable player name {raw!r}")
        players.append(name)

    cells: list[tuple[str, ...]] = []
    for row in rows[1:]:
        if len(row) <= _ROUND_COL or not row[_ROUND_COL].strip().isdigit():
            continue
        slice_ = row[_FIRST_PLAYER_COL : _FIRST_PLAYER_COL + len(players)]
        padded = [*(c.strip() for c in slice_), *([""] * (len(players) - len(slice_)))]
        cells.append(tuple(padded))

    if not cells:
        raise ValueError("draft grid: no numbered round rows found")

    return DraftGrid(players=tuple(players), rounds_total=len(cells), cells=tuple(cells))


def parse_cube_list(csv_text: str) -> list[str]:
    """Card names in sheet order, duplicates preserved (the cube lists Explore twice)."""
    names: list[str] = []
    for row in _rows(csv_text)[1:]:
        if len(row) > _CARD_COL and row[_CARD_COL].strip():
            names.append(row[_CARD_COL].strip())
    if not names:
        raise ValueError("cube list: no card names found")
    return names


def pick_sequence(grid: DraftGrid) -> list[Pick]:
    """Picks in draft order. Odd rounds run left-to-right, even rounds reverse."""
    picks: list[Pick] = []
    seq = 0
    for round_index, row in enumerate(grid.cells):
        round_no = round_index + 1
        order = range(len(grid.players)) if round_no % 2 == 1 else reversed(range(len(grid.players)))
        for player_index in order:
            card = row[player_index]
            if not card:
                continue
            seq += 1
            picks.append(Pick(round=round_no, seq=seq, player=grid.players[player_index], card=card))
    return picks


def state_digest(grid: DraftGrid, cube_names: Sequence[str]) -> str:
    """Digest the normalised state only.

    Deliberately excludes the sheet's status block and raw header text, so
    repairing '#REF!' cells does not read as a pick. Raw-byte hashing would
    also work today but is brittle against that churn.
    """
    canonical = json.dumps(
        {
            "players": list(grid.players),
            "cells": [list(row) for row in grid.cells],
            "cube": list(cube_names),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run --extra dev pytest tests/test_rotisserie_parse.py -q`
Expected: PASS, 14 tests.

- [ ] **Step 6: Lint**

Run: `uv run --extra dev ruff check scripts/rotisserie/ tests/test_rotisserie_parse.py`
Expected: `All checks passed!`

- [ ] **Step 7: Verify the stdlib-only constraint holds**

Run: `python3 -c "import sys; sys.path.insert(0, '.'); from scripts.rotisserie import parse; print(parse.csv_url(parse.GRID_GID))"`
Expected: the URL prints using the *system* Python, with no virtualenv active. If this fails with an import error, the module has picked up a third-party dependency and the gate job will break.

- [ ] **Step 8: Commit**

```bash
git add scripts/rotisserie/ tests/test_rotisserie_parse.py tests/fixtures/rotisserie/
git commit -m "$(cat <<'EOF'
Add stdlib-only parser for the rotisserie sheet

Parses both tabs, cleans the #REF! and merged-title prefixes off the player
headers, and derives pick order from the snake layout. The state digest covers
only players, grid cells and cube names, so repairing the sheet's broken status
block does not read as a pick.

Standard library only, so the Actions gate job can run it with the runner's
preinstalled python3 and skip dependency installation entirely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Change gate

**Files:**
- Create: `scripts/rotisserie_changed.py`
- Test: `tests/test_rotisserie_gate.py`

**Interfaces:**
- Consumes: `scripts.rotisserie.parse` (`csv_url`, `fetch_csv`, `parse_grid`, `parse_cube_list`, `state_digest`, `GRID_GID`, `LIST_GID`).
- Produces: `committed_digest(path: Path) -> str | None`, `decide(current: str, previous: str | None) -> bool`, `emit(changed: bool, out_path: str | None) -> None`, `main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: Write the failing tests**

`tests/test_rotisserie_gate.py`:

```python
"""Gate job: compares the live digest against the committed one."""

import json
from pathlib import Path

from scripts import rotisserie_changed as gate


def test_committed_digest_reads_source_digest(tmp_path: Path):
    p = tmp_path / "rotisserie.json"
    p.write_text(json.dumps({"source_digest": "sha256:abc"}), encoding="utf-8")
    assert gate.committed_digest(p) == "sha256:abc"


def test_committed_digest_missing_file_is_none(tmp_path: Path):
    assert gate.committed_digest(tmp_path / "nope.json") is None


def test_committed_digest_malformed_file_is_none(tmp_path: Path):
    p = tmp_path / "rotisserie.json"
    p.write_text("{not json", encoding="utf-8")
    assert gate.committed_digest(p) is None


def test_decide():
    assert gate.decide("sha256:a", "sha256:b") is True
    assert gate.decide("sha256:a", None) is True  # first ever run must publish
    assert gate.decide("sha256:a", "sha256:a") is False


def test_emit_appends_github_output(tmp_path: Path):
    out = tmp_path / "gh_output"
    gate.emit(True, str(out))
    gate.emit(False, str(out))
    assert out.read_text(encoding="utf-8").splitlines() == ["changed=true", "changed=false"]


def test_emit_without_github_output_does_not_raise():
    gate.emit(True, None)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --extra dev pytest tests/test_rotisserie_gate.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.rotisserie_changed'`.

- [ ] **Step 3: Implement the gate**

`scripts/rotisserie_changed.py`:

```python
#!/usr/bin/env python3
"""Gate job: publish only when the draft state actually changed.

Runs on the Actions runner's bare python3 — no uv, no dependency install. Keep
this and scripts/rotisserie/parse.py free of third-party imports.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.rotisserie import parse  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT / "data" / "kubbur" / "rotisserie.json"


def committed_digest(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    digest = payload.get("source_digest") if isinstance(payload, dict) else None
    return digest if isinstance(digest, str) else None


def decide(current: str, previous: str | None) -> bool:
    """Publish on first run (no previous digest) or on any difference."""
    return previous is None or current != previous


def emit(changed: bool, out_path: str | None) -> None:
    value = "true" if changed else "false"
    print(f"changed={value}")
    if out_path:
        with open(out_path, "a", encoding="utf-8") as fh:
            fh.write(f"changed={value}\n")


def main(argv: list[str] | None = None) -> int:
    del argv
    grid = parse.parse_grid(parse.fetch_csv(parse.csv_url(parse.GRID_GID)))
    cube = parse.parse_cube_list(parse.fetch_csv(parse.csv_url(parse.LIST_GID)))
    current = parse.state_digest(grid, cube)
    previous = committed_digest(STATE_PATH)
    changed = decide(current, previous)
    print(f"current={current}\nprevious={previous}")
    emit(changed, os.environ.get("GITHUB_OUTPUT"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --extra dev pytest tests/test_rotisserie_gate.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Smoke-test the gate against the live sheet**

Run: `python3 scripts/rotisserie_changed.py`
Expected: prints a `current=sha256:…` line, `previous=None`, and `changed=true` (no committed JSON exists yet). Uses system `python3` deliberately — this is exactly what the Actions gate does.

- [ ] **Step 6: Lint and commit**

```bash
uv run --extra dev ruff check scripts/ tests/test_rotisserie_gate.py
git add scripts/rotisserie_changed.py tests/test_rotisserie_gate.py
git commit -m "$(cat <<'EOF'
Add the rotisserie change gate

Fetches both tabs, digests the parsed state, and compares it against
source_digest in the committed JSON, writing changed=true|false to
$GITHUB_OUTPUT. Publishes unconditionally on the first run, when no previous
digest exists.

This is what keeps a quiet two-hourly poll from costing a CI run and a Fly
deploy: most runs stop here in about fifteen seconds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scryfall card cache

**Files:**
- Create: `scripts/rotisserie/scryfall.py`
- Create: `tests/fixtures/rotisserie/cards_sample.json`
- Test: `tests/test_rotisserie_cards.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `flatten_card(card: dict) -> dict`, `build_alias_index(by_name: dict[str, dict]) -> dict[str, str]`, `resolve(names: Sequence[str], fetch_batch=..., fetch_one=...) -> tuple[dict[str, dict], list[str]]`, `build_cache(names: Sequence[str]) -> dict[str, dict]`. The cache maps **sheet name → flattened card dict** with keys `name`, `mana_cost`, `cmc`, `type_line`, `colors`, `color_identity`, `rarity`, `layout`, `img_small`, `img_normal`, `scryfall_uri`.

- [ ] **Step 1: Create the fixture**

`tests/fixtures/rotisserie/cards_sample.json` — three shapes that matter: a plain card, an adventure whose Scryfall name differs from the sheet name, and a transform card with **no top-level `image_uris`**.

```json
{
  "Lightning Bolt": {
    "name": "Lightning Bolt",
    "mana_cost": "{R}",
    "cmc": 1.0,
    "type_line": "Instant",
    "colors": ["R"],
    "color_identity": ["R"],
    "rarity": "uncommon",
    "layout": "normal",
    "scryfall_uri": "https://scryfall.com/card/lea/161/lightning-bolt",
    "image_uris": {
      "small": "https://cards.scryfall.io/small/bolt.jpg",
      "normal": "https://cards.scryfall.io/normal/bolt.jpg"
    }
  },
  "Brazen Borrower // Petty Theft": {
    "name": "Brazen Borrower // Petty Theft",
    "mana_cost": "{1}{U}{U} // {1}{U}",
    "cmc": 3.0,
    "type_line": "Creature — Faerie Rogue // Instant — Adventure",
    "colors": ["U"],
    "color_identity": ["U"],
    "rarity": "mythic",
    "layout": "adventure",
    "scryfall_uri": "https://scryfall.com/card/eld/39/brazen-borrower-petty-theft",
    "image_uris": {
      "small": "https://cards.scryfall.io/small/borrower.jpg",
      "normal": "https://cards.scryfall.io/normal/borrower.jpg"
    },
    "card_faces": [
      { "name": "Brazen Borrower" },
      { "name": "Petty Theft" }
    ]
  },
  "Thing in the Ice // Awoken Horror": {
    "name": "Thing in the Ice // Awoken Horror",
    "mana_cost": "{1}{U}",
    "cmc": 2.0,
    "type_line": "Creature — Horror // Creature — Kraken Horror",
    "colors": ["U"],
    "color_identity": ["U"],
    "rarity": "rare",
    "layout": "transform",
    "scryfall_uri": "https://scryfall.com/card/soi/58/thing-in-the-ice-awoken-horror",
    "card_faces": [
      {
        "name": "Thing in the Ice",
        "image_uris": {
          "small": "https://cards.scryfall.io/small/thing.jpg",
          "normal": "https://cards.scryfall.io/normal/thing.jpg"
        }
      },
      {
        "name": "Awoken Horror",
        "image_uris": {
          "small": "https://cards.scryfall.io/small/awoken.jpg",
          "normal": "https://cards.scryfall.io/normal/awoken.jpg"
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/test_rotisserie_cards.py`:

```python
"""Card cache: front-face aliasing, face-image fallback, per-card retry."""

import json
from pathlib import Path

import pytest

from scripts.rotisserie import scryfall

FIXTURES = Path(__file__).parent / "fixtures" / "rotisserie"
SAMPLE = json.loads((FIXTURES / "cards_sample.json").read_text(encoding="utf-8"))


def test_flatten_plain_card():
    out = scryfall.flatten_card(SAMPLE["Lightning Bolt"])
    assert out["name"] == "Lightning Bolt"
    assert out["cmc"] == 1
    assert out["colors"] == ["R"]
    assert out["img_small"] == "https://cards.scryfall.io/small/bolt.jpg"
    assert out["img_normal"] == "https://cards.scryfall.io/normal/bolt.jpg"


def test_flatten_falls_back_to_first_face_images():
    """The 18 transform/MDFC cards in this cube have no top-level image_uris."""
    out = scryfall.flatten_card(SAMPLE["Thing in the Ice // Awoken Horror"])
    assert out["img_small"] == "https://cards.scryfall.io/small/thing.jpg"
    assert out["img_normal"] == "https://cards.scryfall.io/normal/thing.jpg"


def test_flatten_drops_scryfall_api_tracking_params():
    card = dict(SAMPLE["Lightning Bolt"], scryfall_uri="https://scryfall.com/card/x?utm_source=api")
    assert scryfall.flatten_card(card)["scryfall_uri"] == "https://scryfall.com/card/x"


def test_build_alias_index_maps_front_faces_and_split_halves():
    alias = scryfall.build_alias_index(SAMPLE)
    assert alias["Brazen Borrower"] == "Brazen Borrower // Petty Theft"
    assert alias["Thing in the Ice"] == "Thing in the Ice // Awoken Horror"
    assert alias["Lightning Bolt"] == "Lightning Bolt"


def test_resolve_uses_alias_for_front_face_sheet_names():
    def fetch_batch(names):
        return {k: v for k, v in SAMPLE.items()}, []

    def fetch_one(name):  # pragma: no cover - must not be reached
        raise AssertionError("retry should not be needed")

    cache, missing = scryfall.resolve(
        ["Lightning Bolt", "Brazen Borrower", "Thing in the Ice"],
        fetch_batch=fetch_batch,
        fetch_one=fetch_one,
    )
    assert missing == []
    assert set(cache) == {"Lightning Bolt", "Brazen Borrower", "Thing in the Ice"}
    assert cache["Brazen Borrower"]["name"] == "Brazen Borrower // Petty Theft"


def test_resolve_retries_batch_misses_individually():
    """Unholy Annex // Ritual Chamber is not_found in batch but resolves singly."""
    calls: list[str] = []

    def fetch_batch(names):
        return {"Lightning Bolt": SAMPLE["Lightning Bolt"]}, ["Unholy Annex // Ritual Chamber"]

    def fetch_one(name):
        calls.append(name)
        return dict(SAMPLE["Lightning Bolt"], name="Unholy Annex // Ritual Chamber")

    cache, missing = scryfall.resolve(
        ["Lightning Bolt", "Unholy Annex // Ritual Chamber"],
        fetch_batch=fetch_batch,
        fetch_one=fetch_one,
    )
    assert calls == ["Unholy Annex // Ritual Chamber"]
    assert missing == []
    assert cache["Unholy Annex // Ritual Chamber"]["name"] == "Unholy Annex // Ritual Chamber"


def test_resolve_reports_names_it_cannot_find():
    def fetch_batch(names):
        return {}, ["Nonexistent Card"]

    def fetch_one(name):
        return None

    cache, missing = scryfall.resolve(["Nonexistent Card"], fetch_batch=fetch_batch, fetch_one=fetch_one)
    assert cache == {}
    assert missing == ["Nonexistent Card"]


def test_resolve_deduplicates_before_requesting():
    seen: list[list[str]] = []

    def fetch_batch(names):
        seen.append(list(names))
        return {"Explore": dict(SAMPLE["Lightning Bolt"], name="Explore")}, []

    cache, missing = scryfall.resolve(["Explore", "Explore"], fetch_batch=fetch_batch, fetch_one=lambda n: None)
    assert seen == [["Explore"]]
    assert missing == []
    assert set(cache) == {"Explore"}


@pytest.mark.parametrize("size", [1, 74, 75, 76, 150, 151])
def test_chunk_respects_the_75_identifier_limit(size):
    chunks = list(scryfall.chunk([f"c{i}" for i in range(size)], 75))
    assert all(len(c) <= 75 for c in chunks)
    assert sum(len(c) for c in chunks) == size
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run --extra dev pytest tests/test_rotisserie_cards.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.rotisserie.scryfall'`.

- [ ] **Step 4: Implement the cache builder**

`scripts/rotisserie/scryfall.py`:

```python
"""Resolve cube card names to a flat, render-ready cache.

A cube is a closed set, so this runs only when an unknown name appears and its
output is committed. The site never calls Scryfall at runtime.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Iterator, Sequence

API = "https://api.scryfall.com"
USER_AGENT = "mtgkubbur.is/0.1 (+https://mtgkubbur.is; rotisserie draft page)"
BATCH_LIMIT = 75  # Scryfall's documented maximum identifiers per collection request
REQUEST_PAUSE_S = 0.15  # Scryfall asks for <= 10 req/s; this is comfortably under


def chunk(items: Sequence[str], size: int = BATCH_LIMIT) -> Iterator[list[str]]:
    for i in range(0, len(items), size):
        yield list(items[i : i + size])


def _request(url: str, payload: dict | None = None, timeout: int = 30) -> dict | None:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https host
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def fetch_batch(names: Sequence[str]) -> tuple[dict[str, dict], list[str]]:
    """POST /cards/collection. Returns (by Scryfall name, not-found names)."""
    body = {"identifiers": [{"name": n} for n in names]}
    payload = _request(f"{API}/cards/collection", body) or {}
    found = {c["name"]: c for c in payload.get("data", [])}
    missing = [i.get("name", "") for i in payload.get("not_found", [])]
    time.sleep(REQUEST_PAUSE_S)
    return found, missing


def fetch_one(name: str) -> dict | None:
    """GET /cards/named, exact then fuzzy.

    Needed because split-layout Room cards such as
    'Unholy Annex // Ritual Chamber' come back not_found from the batch
    endpoint yet resolve fine here.
    """
    for mode in ("exact", "fuzzy"):
        query = urllib.parse.urlencode({mode: name})
        card = _request(f"{API}/cards/named?{query}")
        time.sleep(REQUEST_PAUSE_S)
        if card:
            return card
    return None


def flatten_card(card: dict) -> dict:
    """Reduce a Scryfall card to what the page renders.

    Resolves the image fallback at build time so the frontend never branches:
    transform and modal_dfc cards carry no top-level image_uris.
    """
    images = card.get("image_uris")
    if not images:
        faces = card.get("card_faces") or []
        images = (faces[0].get("image_uris") if faces else None) or {}
    uri = str(card.get("scryfall_uri", ""))
    return {
        "name": card.get("name", ""),
        "mana_cost": card.get("mana_cost", ""),
        "cmc": int(card.get("cmc") or 0),
        "type_line": card.get("type_line", ""),
        "colors": list(card.get("colors") or []),
        "color_identity": list(card.get("color_identity") or []),
        "rarity": card.get("rarity", ""),
        "layout": card.get("layout", ""),
        "img_small": images.get("small", ""),
        "img_normal": images.get("normal", ""),
        "scryfall_uri": uri.split("?", 1)[0],
    }


def build_alias_index(by_name: dict[str, dict]) -> dict[str, str]:
    """Map every name a sheet might use to the canonical Scryfall name.

    The sheet stores front-face names ('Brazen Borrower'); Scryfall returns
    full names ('Brazen Borrower // Petty Theft'). 539 cards yield 564 aliases.
    """
    alias: dict[str, str] = {}
    for full, card in by_name.items():
        alias.setdefault(full, full)
        alias.setdefault(full.split(" // ", 1)[0], full)
        for face in card.get("card_faces") or []:
            if face.get("name"):
                alias.setdefault(face["name"], full)
    return alias


def resolve(
    names: Sequence[str],
    fetch_batch: Callable[[Sequence[str]], tuple[dict[str, dict], list[str]]] = fetch_batch,
    fetch_one: Callable[[str], dict | None] = fetch_one,
) -> tuple[dict[str, dict], list[str]]:
    """Resolve sheet names to flattened cards. Returns (cache, unresolved names)."""
    unique = list(dict.fromkeys(names))
    raw: dict[str, dict] = {}
    retry: list[str] = []
    for batch in chunk(unique):
        found, missing = fetch_batch(batch)
        raw.update(found)
        retry.extend(missing)

    for name in retry:
        card = fetch_one(name)
        if card:
            raw[card["name"]] = card

    alias = build_alias_index(raw)
    cache: dict[str, dict] = {}
    unresolved: list[str] = []
    for name in unique:
        canonical = alias.get(name)
        if canonical is None:
            unresolved.append(name)
            continue
        cache[name] = flatten_card(raw[canonical])
    return cache, unresolved


def build_cache(names: Sequence[str]) -> dict[str, dict]:
    cache, unresolved = resolve(names)
    if unresolved:
        raise ValueError(f"Scryfall could not resolve {len(unresolved)} card name(s): {unresolved[:10]}")
    return cache


def merge_cache(existing: dict[str, dict], names: Iterable[str]) -> dict[str, dict]:
    """Fetch only names absent from the existing cache; drop names no longer in the cube."""
    wanted = list(dict.fromkeys(names))
    missing = [n for n in wanted if n not in existing]
    fresh = build_cache(missing) if missing else {}
    return {n: (existing.get(n) or fresh[n]) for n in wanted}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run --extra dev pytest tests/test_rotisserie_cards.py -q`
Expected: PASS, 13 tests.

- [ ] **Step 6: Verify against the live API**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '.')
from scripts.rotisserie import scryfall
c = scryfall.build_cache(['Lightning Bolt', 'Brazen Borrower', 'Thing in the Ice', 'Unholy Annex // Ritual Chamber'])
for k, v in c.items():
    print(k, '->', v['name'], '|', v['img_small'][:52])
"
```
Expected: four lines; `Brazen Borrower -> Brazen Borrower // Petty Theft`, `Thing in the Ice -> Thing in the Ice // Awoken Horror`, and every `img_small` a non-empty `https://cards.scryfall.io/small/...` URL. An empty image URL means the face fallback regressed.

- [ ] **Step 7: Lint and commit**

```bash
uv run --extra dev ruff check scripts/ tests/test_rotisserie_cards.py
git add scripts/rotisserie/scryfall.py tests/test_rotisserie_cards.py tests/fixtures/rotisserie/cards_sample.json
git commit -m "$(cat <<'EOF'
Add the Scryfall card cache builder

Batches names 75 at a time, then retries batch misses individually — split
layout Room cards such as Unholy Annex // Ritual Chamber return not_found from
/cards/collection yet resolve from /cards/named.

Two shapes this cube actually hits are handled at build time so the frontend
never branches: 26 cards are stored by front-face name while Scryfall returns
the full name, and 18 transform/MDFC cards carry no top-level image_uris.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Payload builder and fail-loud validation

**Files:**
- Create: `scripts/fetch_rotisserie.py`
- Test: `tests/test_rotisserie_build.py`

**Interfaces:**
- Consumes: `parse.DraftGrid`, `parse.Pick`, `parse.pick_sequence`, `parse.state_digest`; `scryfall.merge_cache`.
- Produces: `build_payload(grid, cube_names, previous, now) -> dict`, `validate(payload, cube_names, previous) -> None` (raises `ValueError`), `main(argv=None) -> int`. Payload keys: `generated_at`, `source_digest`, `cube`, `cube_size`, `rounds_total`, `picks_total`, `picks_made`, `current_round`, `next_player`, `players`, `pools`, `remaining`, `log`.

- [ ] **Step 1: Write the failing tests**

`tests/test_rotisserie_build.py`:

```python
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


def test_validate_rejects_a_shrinking_player_list():
    cube = _cube()
    previous = build.build_payload(_grid(), cube, previous=None, now=NOW)
    p = build.build_payload(_grid(), cube, previous=previous, now=NOW)
    p["players"] = ["Binni", "Örvar"]
    p["pools"] = {"Binni": p["pools"]["Binni"], "Örvar": p["pools"]["Örvar"]}
    with pytest.raises(ValueError, match="player set changed"):
        build.validate(p, cube, previous=previous)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --extra dev pytest tests/test_rotisserie_build.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.fetch_rotisserie'`.

- [ ] **Step 3: Implement the builder**

`scripts/fetch_rotisserie.py`:

```python
#!/usr/bin/env python3
"""Build data/kubbur/rotisserie.json and rotisserie_cards.json from the sheet.

Fail-loud by design: the source sheet is edited by hand, so invalid data must
turn the build red rather than overwrite good published state.
"""

from __future__ import annotations

import json
import logging
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.rotisserie import parse, scryfall  # noqa: E402

logger = logging.getLogger("rotisserie")

ROOT = Path(__file__).resolve().parent.parent
KUBBUR = ROOT / "data" / "kubbur"
STATE_PATH = KUBBUR / "rotisserie.json"
CARDS_PATH = KUBBUR / "rotisserie_cards.json"

CUBE_NAME = "Meta Memories"


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def build_payload(
    grid: parse.DraftGrid,
    cube_names: list[str],
    previous: dict | None,
    now: str,
) -> dict:
    picks = parse.pick_sequence(grid)

    pools: dict[str, list[str]] = {p: [] for p in grid.players}
    for pick in picks:
        pools[pick.player].append(pick.card)

    seen: dict[str, str] = {}
    for entry in (previous or {}).get("log", []):
        key = f"{entry.get('player')}\x00{entry.get('card')}"
        if entry.get("first_seen"):
            seen[key] = entry["first_seen"]

    log = [
        {
            "round": pick.round,
            "seq": pick.seq,
            "player": pick.player,
            "card": pick.card,
            "first_seen": seen.get(f"{pick.player}\x00{pick.card}", now),
        }
        for pick in picks
    ]
    log.reverse()  # newest first

    remaining_counter = Counter(cube_names) - Counter(c for pool in pools.values() for c in pool)
    remaining = [n for n in dict.fromkeys(cube_names) for _ in range(remaining_counter[n])]

    picks_total = grid.rounds_total * len(grid.players)
    picks_made = len(picks)

    return {
        "generated_at": now,
        "source_digest": parse.state_digest(grid, cube_names),
        "cube": CUBE_NAME,
        "cube_size": len(set(cube_names)),
        "rounds_total": grid.rounds_total,
        "picks_total": picks_total,
        "picks_made": picks_made,
        "current_round": _current_round(grid, picks_made),
        "next_player": _next_player(grid, picks_made),
        "players": list(grid.players),
        "pools": pools,
        "remaining": remaining,
        "log": log,
    }


def _current_round(grid: parse.DraftGrid, picks_made: int) -> int:
    n = len(grid.players)
    if picks_made >= grid.rounds_total * n:
        return grid.rounds_total
    return picks_made // n + 1


def _next_player(grid: parse.DraftGrid, picks_made: int) -> str | None:
    n = len(grid.players)
    if picks_made >= grid.rounds_total * n:
        return None
    round_no = picks_made // n + 1
    offset = picks_made % n
    index = offset if round_no % 2 == 1 else n - 1 - offset
    return grid.players[index]


def validate(payload: dict, cube_names: list[str], previous: dict | None) -> None:
    cube_counts = Counter(cube_names)
    drafted = Counter(c for pool in payload["pools"].values() for c in pool)

    unknown = sorted(set(drafted) - set(cube_counts))
    if unknown:
        raise ValueError(f"picked card(s) not in the cube list: {unknown[:10]}")

    for card, count in drafted.items():
        if count > cube_counts[card]:
            raise ValueError(f"{card!r} drafted {count} time(s) but the cube lists {cube_counts[card]}")

    if not payload["players"]:
        raise ValueError("no players parsed from the draft grid")

    if previous:
        old_players = set(previous.get("players") or [])
        if old_players and old_players != set(payload["players"]):
            raise ValueError(f"player set changed: {sorted(old_players)} -> {sorted(payload['players'])}")

        old_pairs = {(e["player"], e["card"]) for e in previous.get("log", [])}
        new_pairs = {(e["player"], e["card"]) for e in payload["log"]}
        gone = sorted(old_pairs - new_pairs)
        if gone:
            raise ValueError(f"previously observed pick(s) disappeared: {gone[:10]}")


def main(argv: list[str] | None = None) -> int:
    del argv
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    grid = parse.parse_grid(parse.fetch_csv(parse.csv_url(parse.GRID_GID)))
    cube_names = parse.parse_cube_list(parse.fetch_csv(parse.csv_url(parse.LIST_GID)))

    dupes = sorted(n for n, c in Counter(cube_names).items() if c > 1)
    if dupes:
        logger.warning("cube list has duplicate row(s) for: %s", dupes)

    previous = _load(STATE_PATH)
    payload = build_payload(grid, cube_names, previous, _now())
    validate(payload, cube_names, previous)

    cards = scryfall.merge_cache(_load(CARDS_PATH) or {}, cube_names)

    KUBBUR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    CARDS_PATH.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    logger.info(
        "picks %d/%d, round %d, next %s, %d remaining, %d cards cached",
        payload["picks_made"],
        payload["picks_total"],
        payload["current_round"],
        payload["next_player"],
        len(payload["remaining"]),
        len(cards),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --extra dev pytest tests/test_rotisserie_build.py -q`
Expected: PASS, 14 tests.

- [ ] **Step 5: Generate the real JSON**

Run: `python3 scripts/fetch_rotisserie.py`
Expected: an `INFO picks 1/360, round 1, next Örvar, 539 remaining, 539 cards cached` line, and both files created under `data/kubbur/`. The first run takes about 15 seconds because it resolves the whole cube against Scryfall; later runs make no API calls.

Verify:
```bash
python3 -c "
import json
d = json.load(open('data/kubbur/rotisserie.json', encoding='utf-8'))
c = json.load(open('data/kubbur/rotisserie_cards.json', encoding='utf-8'))
print('players', d['players'])
print('picks', d['picks_made'], '/', d['picks_total'], 'next', d['next_player'])
print('remaining', len(d['remaining']), 'cards cached', len(c))
print('no images:', [k for k, v in c.items() if not v['img_small']][:5])
"
```
Expected: eight players, `picks 1 / 360`, `next Örvar`, `remaining 539`, `cards cached 539`, and an **empty** no-images list.

- [ ] **Step 6: Lint and commit**

```bash
uv run --extra dev ruff check scripts/ tests/test_rotisserie_build.py
git add scripts/fetch_rotisserie.py tests/test_rotisserie_build.py data/kubbur/rotisserie.json data/kubbur/rotisserie_cards.json
git commit -m "$(cat <<'EOF'
Build the rotisserie draft state and card cache

Assembles pools, remaining pool, snake-ordered log and draft status, preserving
first_seen for picks already observed so the "last pick seen" timestamp stays
honest across runs.

Validation is fail-loud: unknown cards, over-drafting a name beyond the copies
the cube lists, a changed player set, or a retracted pick each abort the build
rather than overwrite good published state. remaining is a multiset difference
because the cube genuinely lists Explore twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Publish schemas

**Files:**
- Create: `data/kubbur-schemas/rotisserie.schema.json`, `data/kubbur-schemas/rotisserie_cards.schema.json`
- Modify: `scripts/validate_publish.py` (the `SINGLE` mapping)
- Test: `tests/test_rotisserie_schema.py`

**Interfaces:**
- Consumes: the JSON written by Task 4.
- Produces: two schema files registered in `validate_publish.SINGLE`.

- [ ] **Step 1: Write the failing test**

`tests/test_rotisserie_schema.py`:

```python
"""The published rotisserie JSON validates against its schemas."""

import json
from pathlib import Path

import fastjsonschema
import pytest

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "kubbur"
SCHEMAS = ROOT / "data" / "kubbur-schemas"

PAIRS = [("rotisserie.schema.json", "rotisserie.json"), ("rotisserie_cards.schema.json", "rotisserie_cards.json")]


@pytest.mark.parametrize(("schema_name", "data_name"), PAIRS)
def test_published_json_matches_schema(schema_name, data_name):
    schema = json.loads((SCHEMAS / schema_name).read_text(encoding="utf-8"))
    payload = json.loads((DATA / data_name).read_text(encoding="utf-8"))
    fastjsonschema.compile(schema)(payload)


def test_schemas_are_registered_in_validate_publish():
    from scripts.validate_publish import SINGLE

    for schema_name, data_name in PAIRS:
        assert SINGLE[schema_name] == data_name
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev --extra data pytest tests/test_rotisserie_schema.py -q`
Expected: FAIL — `FileNotFoundError` for `rotisserie.schema.json`.

- [ ] **Step 3: Write the schemas**

`data/kubbur-schemas/rotisserie.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Rotisserie draft state",
  "type": "object",
  "required": ["generated_at", "source_digest", "cube", "rounds_total", "picks_total",
               "picks_made", "current_round", "players", "pools", "remaining", "log"],
  "properties": {
    "generated_at": { "type": "string" },
    "source_digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
    "cube": { "type": "string", "minLength": 1 },
    "cube_size": { "type": "integer", "minimum": 1 },
    "rounds_total": { "type": "integer", "minimum": 1 },
    "picks_total": { "type": "integer", "minimum": 1 },
    "picks_made": { "type": "integer", "minimum": 0 },
    "current_round": { "type": "integer", "minimum": 1 },
    "next_player": { "type": ["string", "null"] },
    "players": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
    "pools": {
      "type": "object",
      "additionalProperties": { "type": "array", "items": { "type": "string" } }
    },
    "remaining": { "type": "array", "items": { "type": "string" } },
    "log": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["round", "seq", "player", "card"],
        "properties": {
          "round": { "type": "integer", "minimum": 1 },
          "seq": { "type": "integer", "minimum": 1 },
          "player": { "type": "string", "minLength": 1 },
          "card": { "type": "string", "minLength": 1 },
          "first_seen": { "type": "string" }
        }
      }
    }
  }
}
```

`data/kubbur-schemas/rotisserie_cards.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Rotisserie card cache",
  "type": "object",
  "minProperties": 1,
  "additionalProperties": {
    "type": "object",
    "required": ["name", "cmc", "type_line", "colors", "img_small", "img_normal"],
    "properties": {
      "name": { "type": "string", "minLength": 1 },
      "mana_cost": { "type": "string" },
      "cmc": { "type": "integer", "minimum": 0 },
      "type_line": { "type": "string" },
      "colors": { "type": "array", "items": { "type": "string", "enum": ["W", "U", "B", "R", "G"] } },
      "color_identity": { "type": "array", "items": { "type": "string" } },
      "rarity": { "type": "string" },
      "layout": { "type": "string" },
      "img_small": { "type": "string", "minLength": 1 },
      "img_normal": { "type": "string", "minLength": 1 },
      "scryfall_uri": { "type": "string" }
    }
  }
}
```

Note `"minLength": 1` on both image fields — that is what turns a regression in the face-image fallback into a red publish gate rather than 18 broken images on the page.

- [ ] **Step 4: Register the schemas**

In `scripts/validate_publish.py`, extend the `SINGLE` dict:

```python
SINGLE = {
    "meta.schema.json": "meta.json",
    "rankings.schema.json": "rankings.json",
    "head_to_head.schema.json": "head_to_head.json",
    "calendar.schema.json": "calendar.json",
    "cubes.schema.json": "cubes.json",
    "rotisserie.schema.json": "rotisserie.json",
    "rotisserie_cards.schema.json": "rotisserie_cards.json",
}
```

- [ ] **Step 5: Run the test and the publish gate**

Run: `uv run --extra dev --extra data pytest tests/test_rotisserie_schema.py -q`
Expected: PASS, 3 tests.

Run: `uv run --extra data python scripts/validate_publish.py`
Expected: exits 0 with no error output.

- [ ] **Step 6: Commit**

```bash
git add data/kubbur-schemas/rotisserie*.schema.json scripts/validate_publish.py tests/test_rotisserie_schema.py
git commit -m "$(cat <<'EOF'
Add publish schemas for the rotisserie JSON

Registers both files with validate_publish so a malformed payload fails the
deploy gate. img_small and img_normal require minLength 1, which turns a
regression in the transform-card image fallback into a red build instead of
eighteen broken images on the page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Data loaders and the `/data/rotisserie` endpoint

**Files:**
- Modify: `app/data.py` (add loaders + prewarm entry), `app/routes/data_api.py` (add endpoint)
- Test: `tests/test_rotisserie_data.py`

**Interfaces:**
- Consumes: `data/kubbur/rotisserie.json`, `data/kubbur/rotisserie_cards.json`.
- Produces: `data.load_rotisserie() -> dict`, `data.load_rotisserie_cards() -> dict`, `GET /data/rotisserie` returning `{"draft": <state>, "cards": <cache>}`.

- [ ] **Step 1: Write the failing tests**

`tests/test_rotisserie_data.py`:

```python
"""Fail-soft loaders and the merged /data/rotisserie endpoint."""

from fastapi.testclient import TestClient

from app import data
from app.main import app

client = TestClient(app)


def test_load_rotisserie_returns_the_published_state():
    d = data.load_rotisserie()
    assert d["cube"] == "Meta Memories"
    assert len(d["players"]) == 8
    assert d["picks_total"] == d["rounds_total"] * len(d["players"])


def test_load_rotisserie_cards_covers_every_referenced_card():
    d, cards = data.load_rotisserie(), data.load_rotisserie_cards()
    referenced = {c for pool in d["pools"].values() for c in pool} | set(d["remaining"])
    assert referenced <= set(cards)


def test_loaders_are_fail_soft(monkeypatch, tmp_path):
    monkeypatch.setattr(data, "KUBBUR_DIR", tmp_path)
    data._reset_cache()
    try:
        assert data.load_rotisserie() == {}
        assert data.load_rotisserie_cards() == {}
    finally:
        data._reset_cache()


def test_data_endpoint_returns_draft_and_cards():
    r = client.get("/data/rotisserie")
    assert r.status_code == 200
    payload = r.json()
    assert set(payload) == {"draft", "cards"}
    assert payload["draft"]["cube"] == "Meta Memories"
    first = payload["draft"]["players"][0]
    assert first in payload["draft"]["pools"]
    assert payload["cards"], "card cache must not be empty"


def test_every_cached_card_has_images():
    cards = data.load_rotisserie_cards()
    broken = [n for n, c in cards.items() if not c.get("img_small") or not c.get("img_normal")]
    assert broken == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --extra dev pytest tests/test_rotisserie_data.py -q`
Expected: FAIL — `AttributeError: module 'app.data' has no attribute 'load_rotisserie'`.

- [ ] **Step 3: Add the loaders**

In `app/data.py`, after `load_head_to_head()`:

```python
def load_rotisserie() -> dict:
    return _cached("rotisserie", lambda: load_json(KUBBUR_DIR / "rotisserie.json") or {})


def load_rotisserie_cards() -> dict:
    return _cached("rotisserie_cards", lambda: load_json(KUBBUR_DIR / "rotisserie_cards.json") or {})
```

The `monkeypatch` test above reassigns `data.KUBBUR_DIR`, so the loaders must reference the module-level name at call time — which the lambdas do.

Add both to the `prewarm()` tuple:

```python
def prewarm() -> None:
    for fn in (
        load_meta,
        load_rankings,
        load_calendar,
        load_cubes_index,
        load_head_to_head,
        load_rotisserie,
        load_rotisserie_cards,
        player_index,
        cube_index,
    ):
```

Leave `healthz_ok()` untouched: the rotisserie page is not core, and a missing file must not mark the app degraded.

- [ ] **Step 4: Add the endpoint**

In `app/routes/data_api.py`, after `head_to_head_data()`:

```python
@router.get("/rotisserie")
async def rotisserie_data():
    """Draft state plus the card cache in one payload, so the page fetches once."""
    return {"draft": data.load_rotisserie(), "cards": data.load_rotisserie_cards()}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run --extra dev pytest tests/test_rotisserie_data.py -q`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
uv run --extra dev ruff check app/ tests/test_rotisserie_data.py
git add app/data.py app/routes/data_api.py tests/test_rotisserie_data.py
git commit -m "$(cat <<'EOF'
Serve the rotisserie state through /data/rotisserie

Adds fail-soft loaders alongside the existing published-JSON readers and a
single endpoint returning both the draft state and the card cache, so the page
makes one request rather than two. healthz stays untouched: this page is not
core, and a missing file must not mark the app degraded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Unlisted route, template and strings

**Files:**
- Create: `app/routes/rotisserie.py`, `app/templates/rotisserie.html`
- Modify: `app/main.py`, `app/strings.py`
- Test: `tests/test_rotisserie_page.py`

**Interfaces:**
- Consumes: `data.load_rotisserie()`.
- Produces: `GET /rotisserie` rendering `rotisserie.html` with mount points `rot-status`, `rot-pools`, `rot-remaining`, `rot-log`, plus the filter controls `rot-search`, `rot-colour-filters`, `rot-type-filter`.

- [ ] **Step 1: Write the failing tests**

`tests/test_rotisserie_page.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --extra dev pytest tests/test_rotisserie_page.py -q`
Expected: FAIL — 404 on `/rotisserie`, plus `KeyError: 'rotisserie_title'`.

- [ ] **Step 3: Add the strings**

In `app/strings.py`, before the closing `},` of the `"is"` dict:

```python
        # ---- Rotisserie (/rotisserie, unlisted) ----
        "rotisserie_title": "Rotisserie-draft",
        "rotisserie_desc": "Meta Memories — staðan í drafti",
        "rotisserie_round": "Umferð",
        "rotisserie_of": "af",
        "rotisserie_picks": "Val",
        "rotisserie_next": "Næstur",
        "rotisserie_done": "Drafti lokið",
        "rotisserie_last_seen": "Síðasta val séð",
        "rotisserie_pools": "Spilastokkar",
        "rotisserie_remaining": "Eftir í kubbnum",
        "rotisserie_log": "Valsaga",
        "rotisserie_search": "Leita að spili…",
        "rotisserie_type_all": "Allar tegundir",
        "rotisserie_no_cards": "Engin spil valin enn",
        "rotisserie_no_matches": "Ekkert spil passar við síuna",
        "rotisserie_cards_count": "spil",
        "rotisserie_expand": "Sýna",
        "rotisserie_collapse": "Fela",
        "colour_w": "Hvítur",
        "colour_u": "Blár",
        "colour_b": "Svartur",
        "colour_r": "Rauður",
        "colour_g": "Grænn",
        "colour_gold": "Fjöllitur",
        "colour_colourless": "Litlaus",
        "colour_land": "Lönd",
        "type_creature": "Skepnur",
        "type_instant": "Skyndi",
        "type_sorcery": "Galdrar",
        "type_artifact": "Gripir",
        "type_enchantment": "Álög",
        "type_planeswalker": "Planeswalker",
        "type_land": "Lönd",
```

- [ ] **Step 4: Add the route**

`app/routes/rotisserie.py`:

```python
"""Rotisserie draft page — unlisted.

Deliberately absent from the nav and marked noindex. No authentication: the
source Google Sheet is already world-readable, so the page discloses nothing
new and auth would be theatre. See the design spec for the full reasoning.
"""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.strings import STRINGS
from app.templating import templates

router = APIRouter()
_S = STRINGS["is"]


@router.get("/rotisserie", response_class=HTMLResponse)
async def rotisserie(request: Request):
    ctx = {
        "page": "rotisserie",
        "header_h1": _S["rotisserie_title"],
        "header_desc": _S["rotisserie_desc"],
    }
    return templates.TemplateResponse(request, "rotisserie.html", ctx)
```

In `app/main.py`, extend the import and register the router:

```python
from app.routes import dagatal, data_api, einvigi, kubbar, methods, rankings, rotisserie, throun
```

```python
app.include_router(rotisserie.router)
```

- [ ] **Step 5: Add the template**

`app/templates/rotisserie.html`:

```html
{% extends "base.html" %} {% block title %}{{ S.rotisserie_title }} — {{ S.brand }}{% endblock %}

{% block head %}
<meta name="robots" content="noindex, nofollow" />
{% endblock %}

{% block content %} {% include "components/page_header.html" %}

<div class="rot-content">
  <div id="rot-status" class="rot-status"></div>

  <h2 class="rot-section-title">{{ S.rotisserie_pools }}</h2>
  <div id="rot-pools"></div>

  <h2 class="rot-section-title">{{ S.rotisserie_remaining }}</h2>
  <div class="rot-filters">
    <input id="rot-search" type="search" placeholder="{{ S.rotisserie_search }}" aria-label="{{ S.rotisserie_search }}" />
    <div id="rot-colour-filters" class="rot-colour-filters"></div>
    <select id="rot-type-filter" aria-label="{{ S.rotisserie_type_all }}">
      <option value="">{{ S.rotisserie_type_all }}</option>
    </select>
  </div>
  <div id="rot-remaining"></div>

  <h2 class="rot-section-title">{{ S.rotisserie_log }}</h2>
  <div id="rot-log"></div>
</div>

<div id="rot-lightbox" class="rot-lightbox" hidden>
  <img alt="" />
</div>
{% endblock %}

{% block scripts %}
<script type="module" src="/static/js/rotisserie.js"></script>
{% endblock %}
```

Note the `noindex` goes in `{% block head %}`, which `base.html` already provides — no change to `base.html` is needed for this task.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run --extra dev pytest tests/test_rotisserie_page.py tests/test_strings.py -q`
Expected: PASS. `test_strings.py` is included because it may assert on the shape of the strings table.

- [ ] **Step 7: Commit**

```bash
uv run --extra dev ruff check app/ tests/
git add app/routes/rotisserie.py app/templates/rotisserie.html app/main.py app/strings.py tests/test_rotisserie_page.py
git commit -m "$(cat <<'EOF'
Add the unlisted /rotisserie page shell

Renders the header, section headings, filter controls and the mount points the
client module targets. Absent from the nav and marked noindex; a test asserts
no page links to it, including itself.

No authentication by design: the source sheet is already world-readable, so the
page discloses nothing new. Cloudflare Access is unavailable regardless, since
the apex is grey-clouded straight to Fly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Status header and player pools

**Files:**
- Create: `app/static/js/rotisserie.js`
- Modify: `app/static/css/mtg.css`, `app/templates/base.html` (bump `mtg.css?v=`)

**Interfaces:**
- Consumes: `GET /data/rotisserie` → `{draft, cards}`; string keys from Task 7.
- Produces: exported-by-convention module-level functions `colourGroup(card)`, `groupPool(names, cards)`, `renderStatus()`, `renderPools()`. Later tasks add `renderRemaining()` and `renderLog()` to the same file.

- [ ] **Step 1: Write the module**

`app/static/js/rotisserie.js`:

```javascript
// Rotisserie draft page — one fetch of /data/rotisserie, then render status,
// per-player pools, the remaining pool browser and the pick log.
const S = window.STR;

const els = {
  status: document.getElementById("rot-status"),
  pools: document.getElementById("rot-pools"),
  remaining: document.getElementById("rot-remaining"),
  log: document.getElementById("rot-log"),
  search: document.getElementById("rot-search"),
  colourFilters: document.getElementById("rot-colour-filters"),
  typeFilter: document.getElementById("rot-type-filter"),
  lightbox: document.getElementById("rot-lightbox"),
};

let draft = null;
let cards = {};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Colour grouping ──
// Order matters: lands first so a mana-producing dual is not filed under Gold.
const COLOUR_GROUPS = [
  { key: "W", label: () => S.colour_w },
  { key: "U", label: () => S.colour_u },
  { key: "B", label: () => S.colour_b },
  { key: "R", label: () => S.colour_r },
  { key: "G", label: () => S.colour_g },
  { key: "GOLD", label: () => S.colour_gold },
  { key: "C", label: () => S.colour_colourless },
  { key: "LAND", label: () => S.colour_land },
];

function colourGroup(card) {
  if (!card) return "C";
  if ((card.type_line || "").includes("Land")) return "LAND";
  const colours = card.colors || [];
  if (colours.length === 0) return "C";
  if (colours.length > 1) return "GOLD";
  return colours[0];
}

function groupPool(names, lookup) {
  const groups = new Map(COLOUR_GROUPS.map((g) => [g.key, []]));
  for (const name of names) {
    const card = lookup[name];
    groups.get(colourGroup(card)).push({ name, card });
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const dc = (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0);
      return dc !== 0 ? dc : String(a.name).localeCompare(String(b.name), "is");
    });
  }
  return groups;
}

// ── Card tile ──
function cardTile({ name, card }, index) {
  const src = card?.img_small || "";
  const full = card?.img_normal || "";
  const label = card?.name || name;
  if (!src) {
    return `<div class="rot-card rot-card-missing" style="--i:${index}">${esc(label)}</div>`;
  }
  return `<img class="rot-card" style="--i:${index}" loading="lazy" decoding="async"
     src="${esc(src)}" data-full="${esc(full)}" alt="${esc(label)}" title="${esc(label)}" />`;
}

// ── 1. Status header ──
function renderStatus() {
  const lastSeen = draft.log?.[0]?.first_seen;
  const next = draft.next_player
    ? `<div class="stat"><span class="stat-label">${esc(S.rotisserie_next)}</span>
         <span class="stat-value rot-next">${esc(draft.next_player)}</span></div>`
    : `<div class="stat"><span class="stat-value">${esc(S.rotisserie_done)}</span></div>`;

  els.status.innerHTML = `
    <div class="player-summary">
      <div class="stat">
        <span class="stat-label">${esc(S.rotisserie_round)}</span>
        <span class="stat-value">${draft.current_round} ${esc(S.rotisserie_of)} ${draft.rounds_total}</span>
      </div>
      <div class="stat">
        <span class="stat-label">${esc(S.rotisserie_picks)}</span>
        <span class="stat-value">${draft.picks_made} ${esc(S.rotisserie_of)} ${draft.picks_total}</span>
      </div>
      ${next}
      ${
        lastSeen
          ? `<div class="stat"><span class="stat-label">${esc(S.rotisserie_last_seen)}</span>
               <span class="stat-value">${esc(fmtSeen(lastSeen))}</span></div>`
          : ""
      }
    </div>`;
}

// The sheet carries no timestamps, so this is when the sync job first observed
// the pick — never presented as when the player actually made it.
function fmtSeen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 2. Player pools ──
function renderPools() {
  els.pools.innerHTML = draft.players
    .map((player) => {
      const names = draft.pools[player] || [];
      if (names.length === 0) {
        return `<section class="rot-pool">
            <h3 class="rot-pool-name">${esc(player)} <span class="rot-pool-count">0</span></h3>
            <p class="empty-state">${esc(S.rotisserie_no_cards)}</p>
          </section>`;
      }
      const groups = groupPool(names, cards);
      const columns = COLOUR_GROUPS.filter((g) => groups.get(g.key).length > 0)
        .map((g) => {
          const list = groups.get(g.key);
          return `<div class="rot-col">
              <div class="rot-col-head">${esc(g.label())} <span>${list.length}</span></div>
              <div class="rot-stack">${list.map(cardTile).join("")}</div>
            </div>`;
        })
        .join("");
      return `<section class="rot-pool">
          <h3 class="rot-pool-name">${esc(player)}
            <span class="rot-pool-count">${names.length} ${esc(S.rotisserie_cards_count)}</span>
          </h3>
          <div class="rot-cols">${columns}</div>
        </section>`;
    })
    .join("");
}

// ── Lightbox ──
function initLightbox() {
  document.addEventListener("click", (ev) => {
    const img = ev.target.closest?.("img.rot-card");
    if (img && img.dataset.full) {
      els.lightbox.querySelector("img").src = img.dataset.full;
      els.lightbox.querySelector("img").alt = img.alt;
      els.lightbox.hidden = false;
      return;
    }
    if (!els.lightbox.hidden) els.lightbox.hidden = true;
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") els.lightbox.hidden = true;
  });
}

// ── Boot ──
async function init() {
  els.status.innerHTML = `<p class="empty-state">${esc(S.loading)}</p>`;
  try {
    const resp = await fetch("/data/rotisserie");
    if (!resp.ok) throw new Error(String(resp.status));
    const payload = await resp.json();
    draft = payload.draft;
    cards = payload.cards || {};
  } catch {
    els.status.innerHTML = `<p class="empty-state">${esc(S.error)}</p>`;
    return;
  }
  if (!draft || !draft.players) {
    els.status.innerHTML = `<p class="empty-state">${esc(S.error)}</p>`;
    return;
  }
  renderStatus();
  renderPools();
  initLightbox();
}

init();
```

- [ ] **Step 2: Add the CSS**

Append to `app/static/css/mtg.css`:

```css
/* ── Rotisserie draft page ─────────────────────────────────────────── */
.rot-content { display: flex; flex-direction: column; gap: 2rem; }
.rot-section-title {
  font-family: var(--font-display);
  font-size: 1.35rem;
  margin: 0 0 0.25rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.35rem;
}
.rot-status .player-summary { margin: 0; }
.rot-next { font-weight: 700; }

.rot-pool { margin-bottom: 2rem; }
.rot-pool-name {
  display: flex; align-items: baseline; gap: 0.6rem;
  font-family: var(--font-display); font-size: 1.1rem; margin: 0 0 0.6rem;
}
.rot-pool-count { font-size: 0.85rem; font-weight: 400; opacity: 0.7; }

.rot-cols { display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; }
.rot-col { flex: 0 0 auto; width: 146px; }
.rot-col-head {
  display: flex; justify-content: space-between;
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
  opacity: 0.75; margin-bottom: 0.35rem;
}
/* Cube Cobra idiom: cards overlap so only the title bar of each shows. */
.rot-stack { position: relative; }
.rot-stack .rot-card { display: block; width: 146px; border-radius: 7px; }
.rot-stack .rot-card + .rot-card { margin-top: -164px; }
.rot-stack .rot-card:hover,
.rot-stack .rot-card:focus-visible { position: relative; z-index: 2; }
.rot-card { cursor: zoom-in; background: var(--surface-2); }
.rot-card-missing {
  width: 146px; height: 204px; display: grid; place-items: center;
  padding: 0.5rem; text-align: center; font-size: 0.75rem;
  border: 1px dashed var(--border); border-radius: 7px;
}

.rot-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; }
.rot-filters input[type="search"] { flex: 1 1 14rem; min-width: 0; }
.rot-colour-filters { display: flex; gap: 0.25rem; }
.rot-colour-btn {
  border: 1px solid var(--border); background: var(--surface-2);
  border-radius: 999px; padding: 0.2rem 0.55rem; cursor: pointer; font-size: 0.9rem;
}
.rot-colour-btn[aria-pressed="true"] { background: var(--accent); color: var(--surface); border-color: var(--accent); }

.rot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.5rem; }
.rot-grid .rot-card { width: 100%; height: auto; border-radius: 7px; }

.rot-log-list { list-style: none; margin: 0; padding: 0; }
.rot-log-list li {
  display: grid; grid-template-columns: 3.5rem 8rem 1fr;
  gap: 0.5rem; padding: 0.3rem 0; border-bottom: 1px solid var(--border); font-size: 0.92rem;
}
.rot-log-round { opacity: 0.6; }
.rot-log-player { font-weight: 600; }

.rot-lightbox {
  position: fixed; inset: 0; z-index: 50; display: grid; place-items: center;
  background: rgb(0 0 0 / 0.72); cursor: zoom-out; padding: 1rem;
}
.rot-lightbox img { max-width: min(94vw, 488px); max-height: 92vh; border-radius: 12px; }

@media (max-width: 640px) {
  .rot-col, .rot-stack .rot-card { width: 120px; }
  .rot-stack .rot-card + .rot-card { margin-top: -135px; }
  .rot-log-list li { grid-template-columns: 2.5rem 1fr; }
  .rot-log-list li .rot-log-card { grid-column: 1 / -1; }
}
```

- [ ] **Step 3: Bump the stylesheet cache-buster**

In `app/templates/base.html`, change `mtg.css?v=3` to `mtg.css?v=4`.

- [ ] **Step 4: Verify in the browser**

Start the preview via the `mtgkubbur.is` entry in `.claude/launch.json`, navigate to `/rotisserie`, then:
- `read_console_messages` — expected: no errors.
- `read_page` — expected: the status block shows round 1 of 45 and `Næstur Binni`… (with one pick made the next player is Örvar), and a `Binni` pool section containing one card image.
- `computer {action: "screenshot"}` — expected: Ragavan's card image renders inside Binni's Red column; every other player shows the empty-state copy.
- `resize_window {preset: "mobile"}` then screenshot — expected: columns scroll horizontally, no page-level horizontal scroll.

- [ ] **Step 5: Run the full suite and commit**

Run: `uv run --extra dev --extra data pytest tests/ -q && uv run --extra dev ruff check .`
Expected: all green.

```bash
git add app/static/js/rotisserie.js app/static/css/mtg.css app/templates/base.html
git commit -m "$(cat <<'EOF'
Render the rotisserie status header and player pools

Fetches /data/rotisserie once and renders the draft status plus a Cube Cobra
style column stack per player, grouped by colour and sorted by CMC. Lands are
grouped before the multicolour check so a dual land is not filed under Gold.

Card images are lazy-loaded thumbnails hotlinked from Scryfall's CDN, with a
click-to-zoom lightbox. The "last seen" figure is labelled as when the sync job
observed the pick, since the sheet carries no timestamps.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Remaining-pool browser and pick log

**Files:**
- Modify: `app/static/js/rotisserie.js`

**Interfaces:**
- Consumes: `draft.remaining`, `draft.log`, `cards`, `colourGroup`, `cardTile`, `esc` from Task 8.
- Produces: `renderRemaining()`, `renderLog()`, both called from `init()`.

- [ ] **Step 1: Add the type vocabulary and filter state**

Insert into `app/static/js/rotisserie.js` above the `// ── Boot ──` section:

```javascript
// ── 3. Remaining pool browser ──
// Ordered: the first match wins, so "Artifact Creature" files under Creature
// and "Land" only catches cards with no other permanent type.
const TYPES = [
  { key: "Creature", label: () => S.type_creature },
  { key: "Planeswalker", label: () => S.type_planeswalker },
  { key: "Instant", label: () => S.type_instant },
  { key: "Sorcery", label: () => S.type_sorcery },
  { key: "Enchantment", label: () => S.type_enchantment },
  { key: "Artifact", label: () => S.type_artifact },
  { key: "Land", label: () => S.type_land },
];

const filters = { text: "", colours: new Set(), type: "" };

function primaryType(card) {
  const line = card?.type_line || "";
  return TYPES.find((t) => line.includes(t.key))?.key || "";
}

function matchesFilters({ name, card }) {
  if (filters.text) {
    const haystack = `${name} ${card?.name || ""}`.toLowerCase();
    if (!haystack.includes(filters.text)) return false;
  }
  if (filters.colours.size > 0 && !filters.colours.has(colourGroup(card))) return false;
  if (filters.type && primaryType(card) !== filters.type) return false;
  return true;
}

function buildFilterControls() {
  els.colourFilters.innerHTML = COLOUR_GROUPS.map(
    (g) =>
      `<button type="button" class="rot-colour-btn" data-colour="${g.key}"
         aria-pressed="false" title="${esc(g.label())}">${esc(g.label().slice(0, 1))}</button>`,
  ).join("");

  els.typeFilter.innerHTML =
    `<option value="">${esc(S.rotisserie_type_all)}</option>` +
    TYPES.map((t) => `<option value="${t.key}">${esc(t.label())}</option>`).join("");

  els.colourFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-colour]");
    if (!btn) return;
    const key = btn.dataset.colour;
    const on = filters.colours.has(key);
    if (on) filters.colours.delete(key);
    else filters.colours.add(key);
    btn.setAttribute("aria-pressed", String(!on));
    renderRemaining();
  });

  els.typeFilter.addEventListener("change", () => {
    filters.type = els.typeFilter.value;
    renderRemaining();
  });

  let debounce;
  els.search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.text = els.search.value.trim().toLowerCase();
      renderRemaining();
    }, 120);
  });
}

function renderRemaining() {
  const entries = draft.remaining.map((name) => ({ name, card: cards[name] }));
  const shown = entries.filter(matchesFilters);
  shown.sort((a, b) => {
    const dc = (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0);
    return dc !== 0 ? dc : String(a.name).localeCompare(String(b.name), "is");
  });

  const summary = `${shown.length} / ${entries.length} ${esc(S.rotisserie_cards_count)}`;
  const body =
    shown.length === 0
      ? `<p class="empty-state">${esc(S.rotisserie_no_matches)}</p>`
      : `<div class="rot-grid">${shown.map(cardTile).join("")}</div>`;

  // <details> keeps 538 images collapsed on day one without any JS state.
  const open = els.remaining.querySelector("details")?.open ? " open" : "";
  els.remaining.innerHTML = `<details class="rot-remaining"${open}>
      <summary>${summary}</summary>${body}
    </details>`;
}

// ── 4. Pick log ──
function renderLog() {
  if (!draft.log || draft.log.length === 0) {
    els.log.innerHTML = `<p class="empty-state">${esc(S.rotisserie_no_cards)}</p>`;
    return;
  }
  els.log.innerHTML = `<ul class="rot-log-list">${draft.log
    .map(
      (e) => `<li>
        <span class="rot-log-round">${esc(S.rotisserie_round)} ${e.round}</span>
        <span class="rot-log-player">${esc(e.player)}</span>
        <span class="rot-log-card">${esc(cards[e.card]?.name || e.card)}</span>
      </li>`,
    )
    .join("")}</ul>`;
}
```

- [ ] **Step 2: Call them from `init()`**

Replace the final three calls in `init()` with:

```javascript
  renderStatus();
  renderPools();
  buildFilterControls();
  renderRemaining();
  renderLog();
  initLightbox();
```

- [ ] **Step 3: Verify in the browser**

Reload `/rotisserie`, then:
- `read_page` — expected: a `<details>` summary reading `539 / 539 spil`, collapsed.
- Expand it, type `bolt` into `#rot-search`, `read_page` — expected: the summary drops to `1 / 539` and only Lightning Bolt renders.
- Click the `R` colour button with the search cleared — expected: the count drops to the red cards only, and the button shows `aria-pressed="true"`.
- Select `Skepnur` in `#rot-type-filter` — expected: the count drops again and the two filters compose.
- `read_console_messages` — expected: no errors.
- Confirm the pick log lists `Umferð 1 · Binni · Ragavan, Nimble Pilferer`.

- [ ] **Step 4: Confirm the collapsed section loads no images**

With the `<details>` collapsed, run `read_network_requests {urlPattern: "cards.scryfall.io"}`.
Expected: only the images inside player pools appear — one, at this stage of the draft. If 500+ requests appear, `loading="lazy"` is not taking effect inside `<details>` and the section needs to render its grid only once opened.

- [ ] **Step 5: Run the suite and commit**

Run: `uv run --extra dev --extra data pytest tests/ -q && uv run --extra dev ruff check .`
Expected: all green.

```bash
git add app/static/js/rotisserie.js
git commit -m "$(cat <<'EOF'
Add the remaining-pool browser and pick log

Client-side filtering over draft.remaining by colour, primary type and name,
composed with AND. Type matching is ordered so "Artifact Creature" files under
Creature rather than Artifact.

The pool sits inside a collapsed <details>, which keeps 538 card images out of
the initial render on day one without any JS state of its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Scheduled workflow

**Files:**
- Create: `.github/workflows/rotisserie.yml`
- Test: `tests/test_rotisserie_workflow.py`

**Interfaces:**
- Consumes: `scripts/rotisserie_changed.py`, `scripts/fetch_rotisserie.py`.
- Produces: the `rotisserie.yml` workflow.

- [ ] **Step 1: Write the failing test**

A structural test, because the failure modes here are silent — a wrong `needs`/`if` pair publishes nothing, and a missing deploy step publishes commits that never reach Fly.

`tests/test_rotisserie_workflow.py`:

```python
"""Structural guards on the rotisserie workflow.

These encode two silent failure modes: a gate that never gates, and a push that
never deploys because GITHUB_TOKEN cannot trigger deploy.yml.
"""

from pathlib import Path

WF = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "rotisserie.yml"


def test_workflow_exists():
    assert WF.exists()


def test_runs_two_hourly_and_on_demand():
    text = WF.read_text(encoding="utf-8")
    assert "*/2 * * *" in text
    assert "workflow_dispatch" in text


def test_sync_job_is_gated_on_the_check_output():
    text = WF.read_text(encoding="utf-8")
    assert "needs: check" in text
    assert "needs.check.outputs.changed == 'true'" in text


def test_gate_job_installs_no_dependencies():
    """The gate's whole point is being cheap; setup-uv would defeat it."""
    text = WF.read_text(encoding="utf-8")
    gate = text.split("check:", 1)[1].split("sync:", 1)[0]
    assert "setup-uv" not in gate
    assert "uv sync" not in gate
    assert "python3 scripts/rotisserie_changed.py" in gate


def test_sync_job_deploys_itself():
    """A GITHUB_TOKEN push cannot trigger deploy.yml, so this job must deploy."""
    text = WF.read_text(encoding="utf-8")
    assert "flyctl deploy" in text
    assert "FLY_API_TOKEN" in text


def test_validation_precedes_the_commit():
    text = WF.read_text(encoding="utf-8")
    assert text.index("validate_publish.py") < text.index("git commit")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run --extra dev pytest tests/test_rotisserie_workflow.py -q`
Expected: FAIL on `test_workflow_exists`.

- [ ] **Step 3: Write the workflow**

`.github/workflows/rotisserie.yml`:

```yaml
name: Rotisserie sync

on:
  schedule:
    # Two-hourly, offset off the hour to dodge the top-of-hour scheduling crush.
    - cron: "17 */2 * * *"
  workflow_dispatch: {}

permissions:
  contents: write

concurrency:
  group: rotisserie-sync
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    outputs:
      changed: ${{ steps.gate.outputs.changed }}
    steps:
      - uses: actions/checkout@v5
      # No setup-uv and no uv sync on purpose: scripts/rotisserie/parse.py is
      # stdlib-only, so the runner's preinstalled python3 is enough and this
      # job finishes in seconds.
      - id: gate
        run: python3 scripts/rotisserie_changed.py

  sync:
    needs: check
    if: needs.check.outputs.changed == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: astral-sh/setup-uv@v7
        with: { version: "0.5.x" }
      - run: uv python install 3.12
      - run: uv sync --extra dev --extra data

      - name: Rebuild the published JSON
        run: uv run --extra data python scripts/fetch_rotisserie.py

      # Validate before committing, so a bad build fails red and leaves the
      # published state untouched.
      - run: uv run --extra data python scripts/validate_publish.py
      - run: uv run --extra dev --extra data pytest tests/ -q
      - run: uv run --extra dev ruff check .

      - name: Commit and push
        id: push
        run: |
          set -euo pipefail
          if git diff --quiet -- data/kubbur/rotisserie.json data/kubbur/rotisserie_cards.json; then
            echo "No file changes after rebuild"
            echo "pushed=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/kubbur/rotisserie.json data/kubbur/rotisserie_cards.json
          git commit -m "data: sync rotisserie draft state"
          git push
          echo "pushed=true" >> "$GITHUB_OUTPUT"

      # This job must deploy itself. GitHub suppresses workflow triggers for
      # pushes made with the default GITHUB_TOKEN, so deploy.yml will not fire
      # here — relying on it would give green builds and a stale site.
      - uses: superfly/flyctl-actions/setup-flyctl@1.6
        if: steps.push.outputs.pushed == 'true'
      - name: Deploy to Fly
        if: steps.push.outputs.pushed == 'true'
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run --extra dev pytest tests/test_rotisserie_workflow.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Validate the YAML parses**

Run: `python3 -c "import json,sys; sys.exit(0)" && uv run --extra dev python -c "
import pathlib, re
t = pathlib.Path('.github/workflows/rotisserie.yml').read_text(encoding='utf-8')
assert re.search(r'^jobs:', t, re.M)
print('workflow reads OK,', len(t.splitlines()), 'lines')
"`
Expected: prints the line count. (PyYAML is not a dependency, so this is a structural read rather than a full parse; GitHub validates the YAML on push.)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/rotisserie.yml tests/test_rotisserie_workflow.py
git commit -m "$(cat <<'EOF'
Add the two-hourly rotisserie sync workflow

A stdlib-only gate job decides whether anything changed; the sync job runs only
when it did, so a quiet poll costs seconds rather than a CI run and a deploy.
Validation and the test suite run before the commit, so a bad build leaves the
published state untouched.

The sync job runs its own flyctl deploy. GitHub suppresses workflow triggers
for pushes made with the default GITHUB_TOKEN, so deploy.yml does not fire for
a same-repo push — relying on it would produce green builds and a site that
silently never updates. Uses the FLY_API_TOKEN already in this repo, so no new
secret is needed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Trigger the workflow once by hand and confirm it is a no-op**

After pushing the branch, run:

```bash
gh workflow run rotisserie.yml --repo mtgkubbur/mtgkubbur.is
```

Then watch it: `gh run watch --repo mtgkubbur/mtgkubbur.is`
Expected: the `check` job succeeds and prints `changed=false` (Task 4 already committed the current state), and the `sync` job is **skipped**. That skip is the whole feature working. If `sync` runs, the digest is not round-tripping and the gate needs investigating before this is left on a schedule.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: source data and parsing → Task 1; the gate → Task 2; card cache with aliasing, retry and face-image fallback → Task 3; data contract, `first_seen`, snake ordering, multiset `remaining`, fail-loud validation → Tasks 4–5; route, unlisted/`noindex`, two-tier serving → Tasks 6–7; layout, pools, remaining browser, pick log → Tasks 8–9; the workflow and its self-deploy → Task 10. The two recorded limitations are honoured concretely: `fmtSeen` is labelled `rotisserie_last_seen` ("Síðasta val séð") rather than implying pick time, and `test_pick_sequence_follows_the_snake` pins the derived-ordering assumption so a double-picks change fails visibly.

**Type consistency.** `DraftGrid`/`Pick` field names are used identically in Tasks 1 and 4. The flattened card keys (`img_small`, `img_normal`, `cmc`, `colors`, `type_line`) are fixed in Task 3, asserted in Task 5's schema, and consumed unchanged in Tasks 8–9. `colourGroup`, `cardTile`, `esc` and `COLOUR_GROUPS` are defined in Task 8 and reused in Task 9 without renaming.

**Two gaps found and closed while reviewing:** Task 6's fail-soft test monkeypatches `data.KUBBUR_DIR`, which only works if the loaders resolve that name at call time — noted explicitly in Step 3. And Task 9 Step 4 adds a network-request check, because `loading="lazy"` inside a collapsed `<details>` is exactly the sort of thing that silently loads 538 images.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, with review between tasks.
2. **Inline Execution** — tasks executed in this session with checkpoints.
