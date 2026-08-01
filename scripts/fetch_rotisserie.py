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

from scripts.rotisserie import parse, scryfall  # noqa: E402, I001

logger = logging.getLogger("rotisserie")

ROOT = Path(__file__).resolve().parent.parent
KUBBUR = ROOT / "data" / "kubbur"
STATE_PATH = KUBBUR / "rotisserie.json"
CARDS_PATH = KUBBUR / "rotisserie_cards.json"

CUBE_NAME = "Meta Memories"


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load(path: Path) -> dict | None:
    """Load a committed JSON state file.

    Returns None only when the file is absent - the legitimate first-run case.
    A file that exists but cannot be read or parsed raises instead of
    returning None: this builder's only safety baseline is the previous
    state, and validate()'s retraction/mutation/player-set checks all become
    no-ops when previous is None, so a corrupt file must abort the build
    rather than silently disable them.

    This deliberately differs from scripts/rotisserie_changed.py's
    committed_digest(), which treats "corrupt" the same as "absent". That
    gate's question is "does this need rebuilding?", where corrupt means
    yes; this builder's question is "is it safe to overwrite the published
    state?", where corrupt means no. Do not "harmonise" the two.
    """
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ValueError(f"{path}: exists but is unreadable/unparseable: {exc}") from exc


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

    # A pick's identity is its grid cell (round, player), not (player, card):
    # the cube lists "Explore" twice, so keying on card would collide a
    # player's two same-named picks and let the second silently inherit the
    # first's first_seen.
    seen: dict[tuple[int, str], tuple[str, str]] = {}
    for entry in (previous or {}).get("log", []):
        if entry.get("first_seen"):
            seen[(entry.get("round"), entry.get("player"))] = (entry.get("card"), entry["first_seen"])

    log = []
    for pick in picks:
        prior = seen.get((pick.round, pick.player))
        # Preserve first_seen only if that cell's card is unchanged; a cell
        # whose card changed is a different pick and gets a fresh timestamp.
        first_seen = prior[1] if prior is not None and prior[0] == pick.card else now
        log.append(
            {
                "round": pick.round,
                "seq": pick.seq,
                "player": pick.player,
                "card": pick.card,
                "first_seen": first_seen,
            }
        )
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

        # Identity is the grid cell (round, player), not (player, card): two
        # cells can share a card name (the cube lists "Explore" twice), which
        # would hide a retraction - or a mutation - behind an unrelated pick.
        old_cells = {(e["round"], e["player"]): e["card"] for e in previous.get("log", [])}
        new_cells = {(e["round"], e["player"]): e["card"] for e in payload["log"]}

        retracted = sorted(old_cells.keys() - new_cells.keys())
        if retracted:
            raise ValueError(f"previously observed pick(s) disappeared (retracted): {retracted[:10]}")

        mutated = sorted(cell for cell in old_cells.keys() & new_cells.keys() if old_cells[cell] != new_cells[cell])
        if mutated:
            changes = [f"{cell}: {old_cells[cell]!r} -> {new_cells[cell]!r}" for cell in mutated[:10]]
            raise ValueError(
                "previously observed pick(s) were mutated, not retracted "
                f"(card changed at the same cell): {changes}"
            )


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
