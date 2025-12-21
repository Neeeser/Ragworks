from __future__ import annotations

from app.services.chat import ChatService


def test_coerce_usage_value_sums_nested_values() -> None:
    value = {"prompt_tokens": "3", "nested": {"completion_tokens": 2.8}, "extra": None}

    assert ChatService._coerce_usage_value(value) == 5


def test_coerce_usage_value_returns_none_for_empty_dict() -> None:
    assert ChatService._coerce_usage_value({}) is None


def test_coerce_numeric_parameter_rejects_non_finite() -> None:
    assert ChatService._coerce_numeric_parameter("nan") is None
    assert ChatService._coerce_numeric_parameter(float("inf")) is None


def test_coerce_bool_parameter_from_strings() -> None:
    assert ChatService._coerce_bool_parameter("yes") is True
    assert ChatService._coerce_bool_parameter("off") is False
    assert ChatService._coerce_bool_parameter("maybe") is None


def test_coerce_list_parameter_parses_string_and_list() -> None:
    assert ChatService._coerce_list_parameter("one,\n two") == ["one", "two"]
    assert ChatService._coerce_list_parameter(["a", " ", None, 3]) == ["a", "3"]


def test_prepare_reasoning_override_coerces_values() -> None:
    raw = {
        "effort": "HIGH",
        "max_tokens": "120",
        "exclude": "true",
        "enabled": "0",
        "extra": "ignore",
    }

    assert ChatService._prepare_reasoning_override(raw) == {
        "effort": "high",
        "max_tokens": 120,
        "exclude": True,
        "enabled": False,
    }
