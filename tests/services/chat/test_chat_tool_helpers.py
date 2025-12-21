from __future__ import annotations

import json

from app.services.chat import ChatService


def test_ensure_arguments_string_wraps_invalid_json() -> None:
    assert ChatService._ensure_arguments_string(" ") == "{}"

    wrapped = ChatService._ensure_arguments_string("plain query")
    assert json.loads(wrapped) == {"input": "plain query"}


def test_ensure_arguments_string_preserves_valid_json() -> None:
    payload = '{"query":"docs"}'

    assert ChatService._ensure_arguments_string(payload) == payload


def test_decode_tool_arguments_handles_strings_and_dicts() -> None:
    assert ChatService._decode_tool_arguments({"query": "docs"}) == {"query": "docs"}
    assert ChatService._decode_tool_arguments("plain") == {"query": "plain"}
    assert ChatService._decode_tool_arguments(" ") == {}


def test_normalize_tool_calls_filters_missing_names() -> None:
    processed_ids: set[str] = set()
    tool_calls = [
        {"id": "skip-me", "function": {"arguments": {"query": "skip"}}},
        {"id": "call-1", "function": {"name": "pinecone_query", "arguments": {"query": "docs"}}},
    ]

    normalized = ChatService._normalize_tool_calls(tool_calls, processed_ids)

    assert len(normalized) == 1
    assert normalized[0]["id"] == "call-1"
    assert normalized[0]["function"]["name"] == "pinecone_query"
    assert ChatService._decode_tool_arguments(normalized[0]["function"]["arguments"]) == {
        "query": "docs"
    }
    assert processed_ids == {"call-1"}


def test_coerce_stream_text_handles_various_shapes() -> None:
    assert (
        ChatService._coerce_stream_text([{"text": "hello"}, {"text": " world"}])
        == "hello world"
    )
    assert ChatService._coerce_stream_text({"text": "hi"}) == "hi"
    assert ChatService._coerce_stream_text(123) == "123"
    assert ChatService._coerce_stream_text(None) is None


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

    ChatService._accumulate_stream_tool_calls(accumulator, updates)

    entry = accumulator[0]
    function_block = entry["function"]
    assert entry["id"] == "call-1"
    assert entry["type"] == "function"
    assert function_block["name"] == "pinecone_query"
    assert function_block["arguments"] == '{"query":"docs"}'
