from __future__ import annotations

from app.chat.processing.parameters import (
    coerce_data_collection,
    coerce_max_price,
    coerce_provider_sort,
    coerce_string_list,
    sanitize_provider_preferences,
)


def test_sanitize_provider_preferences_normalizes_aliases() -> None:
    raw = {
        "order": "router-a,router-b",
        "ignore": ["router-c", None, " "],
        "only": ["router-d"],
        "allowFallbacks": "yes",
        "require-parameters": "off",
        "data-collection": "deny",
        "sort": "latency",
        "MaxPrice": {"prompt": "0.002", "completion": "invalid"},
        12: "ignored",
    }

    sanitized = sanitize_provider_preferences(raw)

    assert sanitized is not None
    assert sanitized["order"] == ["router-a", "router-b"]
    assert sanitized["ignore"] == ["router-c"]
    assert sanitized["only"] == ["router-d"]
    assert sanitized["allow_fallbacks"] is True
    assert sanitized["require_parameters"] is False
    assert sanitized["data_collection"] == "deny"
    assert sanitized["sort"] == "latency"
    assert sanitized["max_price"] == {"prompt": 0.002}


def test_sanitize_provider_preferences_returns_none_for_unknown_keys() -> None:
    assert sanitize_provider_preferences({"unsupported": "value"}) is None


def test_coerce_string_list_handles_tuple_values() -> None:
    assert coerce_string_list(("a", " ", 2)) == ["a", "2"]


def test_provider_preference_helpers_reject_invalid_values() -> None:
    assert coerce_provider_sort("speed") is None
    assert coerce_data_collection("maybe") is None
    assert coerce_max_price("0.1") is None
