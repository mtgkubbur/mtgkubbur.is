#!/usr/bin/env python
"""Fail-closed JSON-Schema validation of data/kubbur against data/kubbur-schemas."""

import json
import sys
from pathlib import Path

import fastjsonschema

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "kubbur"
SCHEMAS = ROOT / "data" / "kubbur-schemas"

SINGLE = {
    "meta.schema.json": "meta.json",
    "rankings.schema.json": "rankings.json",
    "head_to_head.schema.json": "head_to_head.json",
    "calendar.schema.json": "calendar.json",
    "cubes.schema.json": "cubes.json",
}
MULTI = {
    "player.schema.json": "players/*.json",
    "cube_detail.schema.json": "cubes/*.json",
}


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> int:
    errors: list[str] = []
    for schema_name, data_name in SINGLE.items():
        sp, dp = SCHEMAS / schema_name, DATA / data_name
        if not sp.exists() or not dp.exists():
            errors.append(f"missing {schema_name} or {data_name}")
            continue
        validate = fastjsonschema.compile(_load(sp))
        try:
            validate(_load(dp))
        except fastjsonschema.JsonSchemaException as e:
            errors.append(f"{data_name}: {e}")
    for schema_name, glob in MULTI.items():
        sp = SCHEMAS / schema_name
        if not sp.exists():
            errors.append(f"missing {schema_name}")
            continue
        validate = fastjsonschema.compile(_load(sp))
        for dp in sorted(DATA.glob(glob)):
            try:
                validate(_load(dp))
            except fastjsonschema.JsonSchemaException as e:
                errors.append(f"{dp.name}: {e}")
    if errors:
        print("SCHEMA VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        return 1
    print("schema validation OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
