from __future__ import annotations

from app.chat.processing.parameters import (
    coerce_bool_parameter,
    coerce_list_parameter,
    coerce_numeric_parameter,
    normalize_reasoning_effort,
    prepare_reasoning_override,
)
from app.chat.processing.usage import coerce_float_value, coerce_usage_value


def test_coerce_usage_value_sums_nested_values() -> None:
    value = {"prompt_tokens": "3", "nested": {"completion_tokens": 2.8}, "extra": None}

    assert coerce_usage_value(value) == 5


def test_coerce_usage_value_returns_none_for_empty_dict() -> None:
    assert coerce_usage_value({}) is None


def test_coerce_usage_value_rejects_invalid_inputs() -> None:
    assert coerce_usage_value("not-a-number") is None
    assert coerce_usage_value(["list"]) is None


def test_coerce_numeric_parameter_rejects_non_finite() -> None:
    assert coerce_numeric_parameter("nan") is None
    assert coerce_numeric_parameter(float("inf")) is None


def test_coerce_float_value_rejects_invalid_string() -> None:
    assert coerce_float_value("bad") is None


def test_coerce_float_value_rejects_non_numeric_type() -> None:
    assert coerce_float_value([]) is None


def test_coerce_bool_parameter_from_strings() -> None:
    assert coerce_bool_parameter("yes") is True
    assert coerce_bool_parameter("off") is False
    assert coerce_bool_parameter("maybe") is None


def test_coerce_bool_parameter_from_bool_and_number() -> None:
    assert coerce_bool_parameter(True) is True
    assert coerce_bool_parameter(0) is False


def test_coerce_list_parameter_parses_string_and_list() -> None:
    assert coerce_list_parameter("one,\n two") == ["one", "two"]
    assert coerce_list_parameter(["a", " ", None, 3]) == ["a", "3"]


def test_coerce_list_parameter_handles_scalar_value() -> None:
    assert coerce_list_parameter(7) == ["7"]


def test_coerce_numeric_parameter_rejects_empty_and_invalid_types() -> None:
    assert coerce_numeric_parameter(None) is None
    assert coerce_numeric_parameter("   ") is None
    assert coerce_numeric_parameter(["1"]) is None


def test_normalize_reasoning_effort_handles_non_string() -> None:
    assert normalize_reasoning_effort(123) is None


def test_prepare_reasoning_override_coerces_values() -> None:
    raw = {
        "effort": "HIGH",
        "max_tokens": "120",
        "exclude": "true",
        "enabled": "0",
        "extra": "ignore",
    }

    assert prepare_reasoning_override(raw) == {
        "effort": "high",
        "max_tokens": 120,
        "exclude": True,
        "enabled": False,
    }


def test_prepare_reasoning_override_accepts_string_effort() -> None:
    assert prepare_reasoning_override("LOW") == {"effort": "low"}


def test_prepare_reasoning_override_filters_invalid_values() -> None:
    raw = {
        "effort": "loud",
        "max_tokens": "invalid",
        "exclude": "maybe",
    }

    assert prepare_reasoning_override(raw) is None


def test_prepare_reasoning_override_rejects_invalid_string() -> None:
    assert prepare_reasoning_override("fast") is None
