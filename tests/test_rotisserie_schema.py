"""The published rotisserie JSON validates against its schemas."""

import copy
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


def test_published_cards_include_basic_lands():
    """The deckbuilder renders basics from the same cache as every other card."""
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    for name in ("Plains", "Island", "Swamp", "Mountain", "Forest"):
        assert name in payload, name
        assert payload[name]["img_small"], name


# Negative-path tests: verify schemas reject bad payloads


def test_rotisserie_cards_schema_rejects_empty_img_small():
    """Schema must reject empty img_small string."""
    schema = json.loads((SCHEMAS / "rotisserie_cards.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    # Mutate the first card's img_small to empty string
    first_card_key = next(iter(bad_payload.keys()))
    bad_payload[first_card_key]["img_small"] = ""

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_cards_schema_rejects_empty_img_normal():
    """Schema must reject empty img_normal string."""
    schema = json.loads((SCHEMAS / "rotisserie_cards.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_card_key = next(iter(bad_payload.keys()))
    bad_payload[first_card_key]["img_normal"] = ""

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_cards_schema_rejects_missing_img_small():
    """Schema must reject when img_small is absent."""
    schema = json.loads((SCHEMAS / "rotisserie_cards.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_card_key = next(iter(bad_payload.keys()))
    del bad_payload[first_card_key]["img_small"]

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_cards_schema_rejects_colors_as_string():
    """Schema must reject when colors is a string instead of array."""
    schema = json.loads((SCHEMAS / "rotisserie_cards.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_card_key = next(iter(bad_payload.keys()))
    bad_payload[first_card_key]["colors"] = "W"

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_cards_schema_rejects_negative_cmc():
    """Schema must reject when cmc is negative."""
    schema = json.loads((SCHEMAS / "rotisserie_cards.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_card_key = next(iter(bad_payload.keys()))
    bad_payload[first_card_key]["cmc"] = -1

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_cards_schema_rejects_non_object_card():
    """Schema must reject when a card value is not an object."""
    schema = json.loads((SCHEMAS / "rotisserie_cards.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie_cards.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_card_key = next(iter(bad_payload.keys()))
    bad_payload[first_card_key] = "not an object"

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_malformed_source_digest_short():
    """Schema must reject source_digest with wrong hex length."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    bad_payload["source_digest"] = "sha256:abc"

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_uppercase_hex_digest():
    """Schema must reject source_digest with uppercase hex characters."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    # Replace with uppercase version of the actual digest (same length, uppercase hex)
    original = payload["source_digest"]
    uppercase = original.replace(original[7:], original[7:].upper())
    bad_payload["source_digest"] = uppercase

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_empty_players():
    """Schema must reject when players array is empty."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    bad_payload["players"] = []

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_empty_player_name():
    """Schema must reject when a player name is an empty string."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    bad_payload["players"][0] = ""

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_negative_picks_made():
    """Schema must reject when picks_made is negative."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    bad_payload["picks_made"] = -1

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_pools_value_as_string():
    """Schema must reject when a pools value is a string instead of array."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_player_key = next(iter(bad_payload["pools"].keys()))
    bad_payload["pools"][first_player_key] = "not an array"

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_pools_array_with_non_string():
    """Schema must reject when a pools array contains a non-string element."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    first_player_key = next(iter(bad_payload["pools"].keys()))
    bad_payload["pools"][first_player_key].append(123)

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_rejects_empty_next_player():
    """Schema must reject when next_player is an empty string."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    bad_payload = copy.deepcopy(payload)
    bad_payload["next_player"] = ""

    validator = fastjsonschema.compile(schema)
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(bad_payload)


def test_rotisserie_schema_accepts_null_next_player():
    """Schema must accept null for next_player (draft complete)."""
    schema = json.loads((SCHEMAS / "rotisserie.schema.json").read_text(encoding="utf-8"))
    payload = json.loads((DATA / "rotisserie.json").read_text(encoding="utf-8"))
    good_payload = copy.deepcopy(payload)
    good_payload["next_player"] = None

    validator = fastjsonschema.compile(schema)
    # Should not raise
    validator(good_payload)
