from __future__ import annotations

from app.providers.chat.openrouter import build_openrouter_body
from app.chat.usage import (
    UsageSummary,
    coerce_float_value,
    coerce_usage_value,
    extract_reasoning_tokens_from_usage,
)


def test_coerce_usage_value_sums_nested_values() -> None:
    value = {"prompt_tokens": "3", "nested": {"completion_tokens": 2.8}, "extra": None}

    assert coerce_usage_value(value) == 5


def test_coerce_usage_value_returns_none_for_empty_dict() -> None:
    assert coerce_usage_value({}) is None


def test_coerce_usage_value_rejects_invalid_inputs() -> None:
    assert coerce_usage_value("not-a-number") is None
    assert coerce_usage_value(["list"]) is None


def test_coerce_float_value_accepts_numeric_types() -> None:
    assert coerce_float_value(3) == 3.0
    assert coerce_float_value(1.5) == 1.5


def test_coerce_float_value_rejects_invalid_string() -> None:
    assert coerce_float_value("bad") is None


def test_coerce_float_value_rejects_non_numeric_type() -> None:
    assert coerce_float_value([]) is None


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


def test_extract_reasoning_tokens_from_usage_invalid_nested_details() -> None:
    usage = {"completion_tokens_details": {"reasoning_tokens": "bad"}}

    assert extract_reasoning_tokens_from_usage(usage) is None


def test_usage_summary_from_raw_extracts_known_fields() -> None:
    usage = {
        "prompt_tokens": "3",
        "completion_tokens": 5,
        "total_tokens": 8,
        "completion_tokens_details": {"reasoning_tokens": "2"},
        "cost": "0.01",
    }

    summary = UsageSummary.from_raw(usage)

    assert summary == UsageSummary(
        prompt_tokens=3,
        completion_tokens=5,
        total_tokens=8,
        reasoning_tokens=2,
        cost=0.01,
    )


def test_usage_summary_from_raw_empty_payload_is_empty() -> None:
    assert UsageSummary.from_raw(None).is_empty()
    assert UsageSummary.from_raw({}).is_empty()


def test_usage_summary_merged_with_sums_fields_and_treats_none_as_no_data() -> None:
    first = UsageSummary(prompt_tokens=1, total_tokens=7)
    second = UsageSummary(prompt_tokens=2, completion_tokens=3, cost=0.5)

    merged = first.merged_with(second)

    assert merged.prompt_tokens == 3
    assert merged.completion_tokens == 3
    assert merged.total_tokens == 7
    assert merged.cost == 0.5
    assert merged.reasoning_tokens is None


def test_usage_summary_is_empty() -> None:
    assert UsageSummary().is_empty()
    assert not UsageSummary(total_tokens=0).is_empty()
