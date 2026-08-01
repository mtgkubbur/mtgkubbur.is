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

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.rotisserie import parse  # noqa: E402

STATE_PATH = ROOT / "data" / "kubbur" / "rotisserie.json"


def committed_digest(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
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
