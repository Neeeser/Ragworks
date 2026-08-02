"""Compile declarative output fields into strict JSON schemas, and validate.

The schema is what forces the model's output shape (`response_format` or a
forced tool call); the validator is what the engine trusts after parsing.
Both come from the same field list so they cannot drift.
"""

from __future__ import annotations

import json
from typing import Any

from app.pipelines.llm.config import OutputFieldSpec

#: JSON-schema fragment per declared field type.
_TYPE_SCHEMAS: dict[str, dict[str, Any]] = {
    "string": {"type": "string"},
    "number": {"type": "number"},
    "boolean": {"type": "boolean"},
    "string_list": {"type": "array", "items": {"type": "string"}},
}

#: Name of the results array wrapping per-item fields in listwise schemas,
#: and of the index property joining a result back to its numbered item.
RESULTS_KEY = "results"
INDEX_KEY = "index"


class LlmOutputError(ValueError):
    """The model's output failed to parse or validate against the schema."""


def _properties(fields: list[OutputFieldSpec]) -> dict[str, Any]:
    return {
        spec.name: {**_TYPE_SCHEMAS[spec.type], "description": spec.description}
        for spec in fields
    }


def per_item_schema(fields: list[OutputFieldSpec]) -> dict[str, Any]:
    """Strict object schema for one per-item call."""
    return {
        "type": "object",
        "properties": _properties(fields),
        "required": [spec.name for spec in fields],
        "additionalProperties": False,
    }


def listwise_schema(fields: list[OutputFieldSpec]) -> dict[str, Any]:
    """Strict schema for one listwise call: a results array joined by index."""
    entry = {
        "type": "object",
        "properties": {
            INDEX_KEY: {
                "type": "integer",
                "description": "1-based number of the item this result refers to.",
            },
            **_properties(fields),
        },
        "required": [INDEX_KEY, *[spec.name for spec in fields]],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {RESULTS_KEY: {"type": "array", "items": entry}},
        "required": [RESULTS_KEY],
        "additionalProperties": False,
    }


def parse_payload(raw: str) -> dict[str, Any]:
    """Parse the model's textual output as a JSON object.

    Tolerant of a fenced code block around the JSON — the safety net for
    providers that ignore `response_format` — but never of prose: anything
    that doesn't parse to an object is an honest error.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LlmOutputError(f"Model output is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise LlmOutputError("Model output must be a JSON object.")
    return payload


def validate_fields(payload: dict[str, Any], fields: list[OutputFieldSpec]) -> dict[str, Any]:
    """Return the declared fields of one object payload, type-checked."""
    values: dict[str, Any] = {}
    for spec in fields:
        if spec.name not in payload:
            raise LlmOutputError(f"Model output is missing field '{spec.name}'.")
        values[spec.name] = _check_type(spec, payload[spec.name])
    return values


def validate_listwise(
    payload: dict[str, Any], fields: list[OutputFieldSpec], item_count: int
) -> dict[int, dict[str, Any]]:
    """Return per-item field values keyed by 0-based item index.

    Indices outside `1..item_count` are rejected; a duplicated index keeps
    its last occurrence (models occasionally restate a correction).
    """
    results = payload.get(RESULTS_KEY)
    if not isinstance(results, list):
        raise LlmOutputError(f"Model output is missing the '{RESULTS_KEY}' array.")
    by_index: dict[int, dict[str, Any]] = {}
    for entry in results:
        if not isinstance(entry, dict):
            raise LlmOutputError("Each result must be a JSON object.")
        index = entry.get(INDEX_KEY)
        if not isinstance(index, int) or isinstance(index, bool):
            raise LlmOutputError("Each result needs an integer 'index'.")
        if not 1 <= index <= item_count:
            raise LlmOutputError(
                f"Result index {index} is out of range (1..{item_count})."
            )
        by_index[index - 1] = validate_fields(entry, fields)
    return by_index


def _check_type(spec: OutputFieldSpec, value: Any) -> Any:
    kind = spec.type
    if kind == "string" and isinstance(value, str):
        return value
    if kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if kind == "boolean" and isinstance(value, bool):
        return value
    if (
        kind == "string_list"
        and isinstance(value, list)
        and all(isinstance(entry, str) for entry in value)
    ):
        return value
    raise LlmOutputError(
        f"Field '{spec.name}' must be a {kind.replace('_', ' ')}, "
        f"got {type(value).__name__}."
    )
