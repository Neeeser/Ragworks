from __future__ import annotations

from app.services.chat import ChatService


def test_build_openrouter_body_always_includes_usage_flag() -> None:
    reasoning_options = {"reasoning": {"effort": "low"}}

    body = ChatService._build_openrouter_body(reasoning_options)

    assert body["reasoning"]["effort"] == "low"
    assert body["usage"]["include"] is True
    assert "usage" not in reasoning_options


def test_build_openrouter_body_merges_existing_usage_config() -> None:
    reasoning_options = {"usage": {"detail": "full", "include": False}}

    body = ChatService._build_openrouter_body(reasoning_options)

    assert body["usage"]["include"] is True
    assert body["usage"]["detail"] == "full"
    assert reasoning_options["usage"]["include"] is False


def test_build_openrouter_body_with_no_reasoning_options_still_includes_usage() -> None:
    body = ChatService._build_openrouter_body(None)

    assert body == {"usage": {"include": True}}


def test_extract_reasoning_tokens_from_usage_nested_details() -> None:
    usage = {"completion_tokens_details": {"reasoning_tokens": "8"}}

    reasoning_tokens = ChatService._extract_reasoning_tokens_from_usage(usage)

    assert reasoning_tokens == 8
