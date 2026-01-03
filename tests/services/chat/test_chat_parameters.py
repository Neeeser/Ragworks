from __future__ import annotations

from app.chat.processing.parameters import (
    coerce_data_collection,
    coerce_dict_parameter,
    coerce_list_parameter,
    coerce_parameter_value,
    coerce_provider_sort,
    coerce_string_list,
    sanitize_parameter_overrides,
)


def test_sanitize_parameter_overrides_coerces_and_filters() -> None:
    supported = [
        "temperature",
        "top_k",
        "logprobs",
        "stop",
        "verbosity",
        "response_format",
        "reasoning",
    ]
    overrides = {
        "temperature": "0.7",
        "top_k": "4",
        "logprobs": "true",
        "stop": "end,\nstop",
        "verbosity": "HIGH",
        "response_format": {"type": "json_object"},
        "reasoning": {"effort": "high"},
        "unknown": "ignore-me",
    }

    sanitized = sanitize_parameter_overrides(overrides, supported)

    assert sanitized["temperature"] == 0.7
    assert sanitized["top_k"] == 4
    assert sanitized["logprobs"] is True
    assert sanitized["stop"] == ["end", "stop"]
    assert sanitized["verbosity"] == "high"
    assert sanitized["response_format"] == {"type": "json_object"}
    assert sanitized["reasoning"] == {"effort": "high"}
    assert "unknown" not in sanitized


def test_sanitize_parameter_overrides_skips_invalid_values() -> None:
    supported = ["temperature", "verbosity", "stop", "response_format"]
    overrides = {
        "temperature": "nan",
        "verbosity": "louder",
        "stop": "",
        "response_format": "not-json",
    }

    sanitized = sanitize_parameter_overrides(overrides, supported)

    assert sanitized == {}


def test_coerce_dict_parameter_parses_json_string() -> None:
    assert coerce_dict_parameter('{"type":"json_object"}') == {"type": "json_object"}
    assert coerce_dict_parameter(" ") is None


def test_coerce_dict_parameter_rejects_none_and_non_dict_json() -> None:
    assert coerce_dict_parameter(None) is None
    assert coerce_dict_parameter('["list"]') is None
    assert coerce_dict_parameter(123) is None


def test_coerce_list_parameter_returns_none_for_empty_values() -> None:
    assert coerce_list_parameter(None) is None


def test_coerce_parameter_value_handles_unknown_and_enum() -> None:
    assert coerce_parameter_value("unknown", "value") is None
    assert coerce_parameter_value("verbosity", "HIGH") == "high"
    assert coerce_parameter_value("verbosity", 123) is None
    assert coerce_parameter_value("verbosity", "loud") is None


def test_coerce_string_list_handles_mixed_iterables() -> None:
    assert coerce_string_list((" a ", None, 2)) == ["a", "2"]
    assert coerce_string_list(["a", " ", None, "b"]) == ["a", "b"]
    assert coerce_string_list("a, ,b") == ["a", "b"]
    assert coerce_string_list([None, " "]) is None
    assert coerce_string_list(123) is None


def test_provider_option_coercers_accept_none() -> None:
    assert coerce_provider_sort(None) is None
    assert coerce_data_collection(None) is None
