from __future__ import annotations

import json

from app.chat.processing.tool_calls import (
    accumulate_stream_tool_calls,
    coerce_stream_text,
    decode_tool_arguments,
    ensure_arguments_string,
    extract_reasoning_tool_calls,
    merge_reasoning_segments,
    normalize_tool_calls,
    parse_tool_call,
)


def test_parse_tool_call_handles_non_dict_function() -> None:
    """A non-dict `function` block falls back to the default name/query, no id."""
    parsed = parse_tool_call({"function": "oops"}, default_query="query", use_fallback_id=False)

    assert parsed.id is None
    assert parsed.name == "tool_call"
    assert parsed.query_text == "query"
    assert parsed.top_k == 5


def test_parse_tool_call_applies_fallback_id_and_top_k_default() -> None:
    """With `use_fallback_id`, a missing id is generated and a bad top_k clamps to 5."""
    parsed = parse_tool_call(
        {"function": {"name": "pinecone_query", "arguments": {"top_k": "bad"}}},
        default_query="query",
        use_fallback_id=True,
    )

    assert isinstance(parsed.id, str)
    assert parsed.id.startswith("tool_call_")
    assert parsed.top_k == 5


def test_ensure_arguments_string_wraps_invalid_json() -> None:
    assert ensure_arguments_string(" ") == "{}"

    wrapped = ensure_arguments_string("plain query")
    assert json.loads(wrapped) == {"input": "plain query"}


def test_ensure_arguments_string_preserves_valid_json() -> None:
    payload = '{"query":"docs"}'

    assert ensure_arguments_string(payload) == payload


def test_ensure_arguments_string_handles_none() -> None:
    assert ensure_arguments_string(None) == "{}"


def test_decode_tool_arguments_handles_strings_and_dicts() -> None:
    assert decode_tool_arguments({"query": "docs"}) == {"query": "docs"}
    assert decode_tool_arguments("plain") == {"query": "plain"}
    assert decode_tool_arguments(" ") == {}
    assert decode_tool_arguments("{not-json}") == {"query": "{not-json}"}
    assert decode_tool_arguments('["list"]') == {}


def test_decode_tool_arguments_handles_other_types() -> None:
    assert decode_tool_arguments(["value"]) == {}


def test_normalize_tool_calls_filters_missing_names() -> None:
    processed_ids: set[str] = set()
    tool_calls = [
        {"id": "skip-me", "function": {"arguments": {"query": "skip"}}},
        {"id": "call-1", "function": {"name": "pinecone_query", "arguments": {"query": "docs"}}},
    ]

    normalized = normalize_tool_calls(tool_calls, processed_ids)

    assert len(normalized) == 1
    assert normalized[0]["id"] == "call-1"
    assert normalized[0]["function"]["name"] == "pinecone_query"
    assert decode_tool_arguments(normalized[0]["function"]["arguments"]) == {
        "query": "docs"
    }
    assert processed_ids == {"call-1"}


def test_normalize_tool_calls_skips_invalid_function_payload() -> None:
    processed_ids: set[str] = set()
    tool_calls = [
        {"id": "bad-call", "function": "not-a-dict"},
        {"id": "call-1", "function": {"name": "pinecone_query", "arguments": {"query": "docs"}}},
    ]

    normalized = normalize_tool_calls(tool_calls, processed_ids)

    assert len(normalized) == 1
    assert normalized[0]["id"] == "call-1"


def test_coerce_stream_text_handles_various_shapes() -> None:
    assert (
        coerce_stream_text([{"text": "hello"}, {"text": " world"}])
        == "hello world"
    )
    assert coerce_stream_text({"text": "hi"}) == "hi"
    assert coerce_stream_text(123) == "123"
    assert coerce_stream_text(None) is None


def test_accumulate_stream_tool_calls_concatenates_arguments() -> None:
    accumulator: dict[int, dict[str, object]] = {}
    updates = [
        {
            "index": 0,
            "id": "call-1",
            "function": {"name": "pinecone_query", "arguments": '{"query":"do'},
        },
        {
            "index": 0,
            "function": {"arguments": 'cs"}'},
        },
    ]

    accumulate_stream_tool_calls(accumulator, updates)

    entry = accumulator[0]
    function_block = entry["function"]
    assert entry["id"] == "call-1"
    assert entry["type"] == "function"
    assert function_block["name"] == "pinecone_query"
    assert function_block["arguments"] == '{"query":"docs"}'


def test_accumulate_stream_tool_calls_handles_invalid_updates() -> None:
    accumulator: dict[int, dict[str, object]] = {}
    updates = [
        "bad",
        {"index": "oops", "function": "not-a-dict"},
        {"index": 1, "type": "function", "function": {"name": "tool", "arguments": 123}},
    ]

    accumulate_stream_tool_calls(accumulator, updates)

    assert 0 in accumulator
    assert accumulator[1]["function"]["arguments"] == ""


def test_extract_reasoning_tool_calls_extends_existing_context() -> None:
    segments = [
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "pinecone_query",
            "arguments": {"query": "docs"},
        },
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "pinecone_query",
            "arguments": {"query": "more"},
        },
    ]

    tool_calls, context, residual = extract_reasoning_tool_calls(segments, set())

    assert len(tool_calls) == 1
    assert context["call-1"]["segments"] == segments
    assert residual == []


def test_extract_reasoning_tool_calls_ignores_segments_without_names() -> None:
    segments = [{"type": "tool_call", "arguments": {"query": "docs"}}]

    tool_calls, context, residual = extract_reasoning_tool_calls(segments, set())

    assert tool_calls == []
    assert context == {}
    assert residual == segments


def test_coerce_stream_text_handles_lists_and_dicts() -> None:
    assert coerce_stream_text([{"text": "Hello"}, " ", {"text": "world"}]) == "Hello world"
    assert coerce_stream_text({"text": "Hi"}) == "Hi"
    assert coerce_stream_text([{"text": 123}]) is None
    assert coerce_stream_text({"text": 123}) == "{'text': 123}"
    assert coerce_stream_text([1, 2]) is None


def test_merge_reasoning_segments_appends_updates() -> None:
    existing = [{"type": "text", "content": "Start"}]

    merged = merge_reasoning_segments([{"type": "text", "content": "Next"}], existing)

    assert merged[-1]["content"] == "StartNext"


def test_merge_reasoning_segments_skips_empty_updates() -> None:
    existing = [{"type": "text", "content": "Start"}]

    merged = merge_reasoning_segments(None, existing)

    assert merged == existing
