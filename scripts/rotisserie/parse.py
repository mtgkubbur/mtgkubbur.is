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
