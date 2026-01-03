from __future__ import annotations

from app.chat.processing.parameters import build_openrouter_body
from app.chat.processing.usage import extract_reasoning_tokens_from_usage


def test_build_openrouter_body_always_includes_usage_flag() -> None:
    reasoning_options = {"reasoning": {"effort": "low"}}

    body = build_openrouter_body(reasoning_options)

    assert body["reasoning"]["effort"] == "low"
    assert body["usage"]["include"] is True
    assert "usage" not in reasoning_options


def test_build_openrouter_body_merges_existing_usage_config() -> None:
    reasoning_options = {"usage": {"detail": "full", "include": False}}

    body = build_openrouter_body(reasoning_options)

    assert body["usage"]["include"] is True
    assert body["usage"]["detail"] == "full"
    assert reasoning_options["usage"]["include"] is False


def test_build_openrouter_body_with_no_reasoning_options_still_includes_usage() -> None:
    body = build_openrouter_body(None)

    assert body == {"usage": {"include": True}}


def test_build_openrouter_body_includes_provider_options() -> None:
    body = build_openrouter_body(
        {"reasoning": {"effort": "low"}},
        provider_options={"order": ["provider-a"]},
    )

    assert body["provider"] == {"order": ["provider-a"]}


def test_extract_reasoning_tokens_from_usage_nested_details() -> None:
    usage = {"completion_tokens_details": {"reasoning_tokens": "8"}}

    reasoning_tokens = extract_reasoning_tokens_from_usage(usage)

    assert reasoning_tokens == 8


def test_extract_reasoning_tokens_from_usage_direct_value() -> None:
    usage = {"reasoning_tokens": "6"}

    reasoning_tokens = extract_reasoning_tokens_from_usage(usage)

    assert reasoning_tokens == 6


def test_extract_reasoning_tokens_from_usage_empty_payload() -> None:
    assert extract_reasoning_tokens_from_usage({}) is None
