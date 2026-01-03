from __future__ import annotations

from app.chat.processing.parameters import (
    coerce_dict_parameter,
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
