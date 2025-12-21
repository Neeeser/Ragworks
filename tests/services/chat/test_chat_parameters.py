from __future__ import annotations

from app.services.chat import ChatService


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

    sanitized = ChatService._sanitize_parameter_overrides(overrides, supported)

    assert sanitized["temperature"] == 0.7
    assert sanitized["top_k"] == 4
    assert sanitized["logprobs"] is True
    assert sanitized["stop"] == ["end", "stop"]
    assert sanitized["verbosity"] == "high"
    assert sanitized["response_format"] == {"type": "json_object"}
    assert sanitized["reasoning"] == {"effort": "high"}
    assert "unknown" not in sanitized
