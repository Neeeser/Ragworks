"""Schema compilation and response validation behavior."""

from __future__ import annotations

import pytest

from app.pipelines.llm.config import MetadataTarget, OutputFieldSpec, ScoreTarget
from app.pipelines.llm.output_schema import (
    LlmOutputError,
    listwise_schema,
    parse_payload,
    per_item_schema,
    validate_fields,
    validate_listwise,
)


def _field(name: str, kind: str) -> OutputFieldSpec:
    return OutputFieldSpec(
        name=name,
        type=kind,  # type: ignore[arg-type]
        description=f"{name} value",
        target=MetadataTarget(key=name),
    )


def test_per_item_schema_is_strict() -> None:
    schema = per_item_schema([_field("author", "string"), _field("year", "number")])
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["author", "year"]
    assert schema["properties"]["year"]["type"] == "number"


def test_listwise_schema_wraps_results_with_index() -> None:
    schema = listwise_schema(
        [OutputFieldSpec(name="score", type="number", target=ScoreTarget())]
    )
    entry = schema["properties"]["results"]["items"]
    assert entry["required"] == ["index", "score"]
    assert entry["properties"]["index"]["type"] == "integer"


def test_parse_payload_tolerates_fenced_json() -> None:
    assert parse_payload('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_payload_rejects_prose() -> None:
    with pytest.raises(LlmOutputError, match="not valid JSON"):
        parse_payload("Sure! Here's the JSON you asked for: {}")


def test_parse_payload_names_max_output_tokens_on_truncated_json() -> None:
    """A response cut off mid-string is actionable — name the field that fixes it."""
    with pytest.raises(LlmOutputError, match="max_output_tokens"):
        parse_payload('{"topic": "unterminated')


def test_parse_payload_names_max_output_tokens_when_input_runs_out_mid_structure() -> None:
    """Not just unterminated strings — a value cut off after a comma is truncation too."""
    with pytest.raises(LlmOutputError, match="max_output_tokens"):
        parse_payload('{"topic": "alpha", "year":')


def test_validate_fields_checks_types() -> None:
    fields = [_field("tags", "string_list")]
    assert validate_fields({"tags": ["a", "b"]}, fields) == {"tags": ["a", "b"]}
    with pytest.raises(LlmOutputError, match="tags"):
        validate_fields({"tags": "a"}, fields)


def test_validate_fields_rejects_missing_and_bool_as_number() -> None:
    with pytest.raises(LlmOutputError, match="missing"):
        validate_fields({}, [_field("year", "number")])
    with pytest.raises(LlmOutputError, match="year"):
        validate_fields({"year": True}, [_field("year", "number")])


def test_validate_listwise_joins_on_one_based_index() -> None:
    fields = [OutputFieldSpec(name="score", type="number", target=ScoreTarget())]
    payload = {"results": [{"index": 2, "score": 0.9}, {"index": 1, "score": 0.1}]}
    assert validate_listwise(payload, fields, item_count=2) == {
        1: {"score": 0.9},
        0: {"score": 0.1},
    }


def test_validate_listwise_rejects_out_of_range_index() -> None:
    fields = [OutputFieldSpec(name="score", type="number", target=ScoreTarget())]
    with pytest.raises(LlmOutputError, match="out of range"):
        validate_listwise({"results": [{"index": 3, "score": 1.0}]}, fields, item_count=2)
