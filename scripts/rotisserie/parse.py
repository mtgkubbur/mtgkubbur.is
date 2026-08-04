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
from collections.abc import Mapping, Sequence
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


def _collapse_repeated_suffix(text: str) -> str:
    """Collapse a doubled trailing name back to a single copy.

    The header cell is formula output, and its shape has already changed twice
    under us: broken formulas produced '#REF! Name', and repairing them made
    the lookup double up instead ('Name Name', with any leading boilerplate
    such as the merged sheet title left in front, undoubled). This is a
    defence against a moving target, not gratuitous cleverness: it finds the
    longest trailing word-sequence that repeats immediately before itself and
    keeps only the trailing copy, discarding everything before it - the same
    "discard everything before the real name" policy as the '#REF!' strip
    above. Longer sequences are checked before shorter ones so a two-word
    name collapses to itself rather than being chopped mid-name.
    """
    words = text.split()
    total = len(words)
    for k in range(total // 2, 0, -1):
        if words[total - 2 * k : total - k] == words[total - k :]:
            return " ".join(words[total - k :])
    return text


def clean_player_name(raw: str) -> str:
    """Strip the broken-formula and merged-title prefixes off a header cell.

    The live sheet has yielded this in two shapes so far. Broken formulas:
    '#REF! Örvar', with the first column also carrying a merged sheet title
    that bleeds in: 'Rotisserie Draft - Meta memories #REF! Binni'. Repaired
    formulas: the name doubled instead of erroring, e.g. 'Örvar Örvar', or
    'Rotisserie Draft - Meta memories Binni Binni' for the first column. A
    fully repaired, undoubled sheet yields a bare name, which must pass
    through untouched.
    """
    text = raw.strip()
    marker = "#REF!"
    if marker in text:
        text = text.rsplit(marker, 1)[1].strip()
    return _collapse_repeated_suffix(text)


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
    raw_by_name: dict[str, str] = {}
    for raw in raw_names:
        name = clean_player_name(raw)
        if not name or len(name) > _MAX_PLAYER_NAME:
            raise ValueError(f"draft grid: unparsable player name {raw!r}")
        if name in raw_by_name:
            raise ValueError(
                f"draft grid: duplicate player name {name!r} from header cells "
                f"{raw_by_name[name]!r} and {raw!r} - the cleaning logic has failed "
                "against a new header shape"
            )
        raw_by_name[name] = raw
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


def normalise_card(card: str, cube_counts: Mapping[str, int]) -> str:
    """Collapse a numbered duplicate pick ('Explore 1') to its cube name.

    The cube lists Explore twice, and when both copies were drafted the grid
    disambiguated them as 'Explore 1' and 'Explore 2' - names exact-match
    validation rejects (live incident 2026-08-04). Only that narrow shape is
    collapsed: the full name must not itself be a cube card, the stripped
    base must be one listed more than once (numbering a unique card is an
    anomaly, not a convention), and the copy number must be within the listed
    count. Everything else passes through untouched for validate() to reject
    loudly.
    """
    if card in cube_counts:
        return card
    base, sep, num = card.rpartition(" ")
    if sep and num.isdigit() and cube_counts.get(base, 0) >= 2 and 1 <= int(num) <= cube_counts[base]:
        return base
    return card


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
