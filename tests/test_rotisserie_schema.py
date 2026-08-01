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
