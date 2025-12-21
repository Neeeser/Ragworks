from __future__ import annotations

from app.services.chat import ChatService


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

    sanitized = ChatService._sanitize_provider_preferences(raw)

    assert sanitized is not None
    assert sanitized["order"] == ["router-a", "router-b"]
    assert sanitized["ignore"] == ["router-c"]
    assert sanitized["only"] == ["router-d"]
    assert sanitized["allow_fallbacks"] is True
    assert sanitized["require_parameters"] is False
    assert sanitized["data_collection"] == "deny"
    assert sanitized["sort"] == "latency"
    assert sanitized["max_price"] == {"prompt": 0.002}
