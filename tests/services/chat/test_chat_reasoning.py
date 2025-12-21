from __future__ import annotations

from app.services.chat import ChatService


def test_normalize_reasoning_segments_parses_json_string() -> None:
    raw = '[{"type":"tool_call","name":"pinecone_query","arguments":{"query":"docs"}}]'
    segments = ChatService._normalize_reasoning_segments(raw)
    assert len(segments) == 1
    assert segments[0]["name"] == "pinecone_query"


def test_extract_reasoning_tool_calls_creates_openai_payload() -> None:
    segments = [
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "pinecone_query",
            "arguments": {"query": "docs", "top_k": 7},
        },
        {"type": "reasoning", "text": "Thinking"},
    ]
    tool_calls, context, residual = ChatService._extract_reasoning_tool_calls(segments, set())

    assert len(tool_calls) == 1
    call = tool_calls[0]
    assert call["id"] == "call-1"
    assert call["function"]["name"] == "pinecone_query"
    args = ChatService._decode_tool_arguments(call["function"]["arguments"])
    assert args == {"query": "docs", "top_k": 7}
    assert "call-1" in context
    assert residual == [{"type": "reasoning", "text": "Thinking"}]


def test_build_reasoning_options_honors_supported_parameters() -> None:
    supported = ["temperature", "include_reasoning", "reasoning"]
    options = ChatService._build_reasoning_options(supported, "high")

    assert "include_reasoning" not in options
    assert options["reasoning"] == {"effort": "high"}


def test_extract_reasoning_tool_calls_captures_leading_context_and_residual_segments() -> None:
    segments = [
        {"type": "text", "content": "Step 1"},
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "pinecone_query",
            "arguments": {"query": "docs"},
        },
        {"type": "text", "content": "post-tool reflection"},
    ]

    tool_calls, context, residual = ChatService._extract_reasoning_tool_calls(segments, set())

    assert len(tool_calls) == 1
    assert context["call-1"]["segments"][0]["content"] == "Step 1"
    assert context["call-1"]["segments"][1]["id"] == "call-1"
    assert residual == [{"type": "text", "content": "post-tool reflection"}]


def test_extract_reasoning_tool_calls_handles_multiple_calls_and_shared_context() -> None:
    segments = [
        {"type": "text", "content": "preface"},
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "pinecone_query",
            "arguments": {"query": "docs"},
        },
        {"type": "text", "content": "between calls"},
        {
            "type": "function_call",
            "call": {"id": "call-2", "name": "pinecone_query", "arguments": {"query": "more"}},
        },
    ]

    tool_calls, context, residual = ChatService._extract_reasoning_tool_calls(segments, set())

    assert {call["id"] for call in tool_calls} == {"call-1", "call-2"}
    assert context["call-1"]["segments"][0]["content"] == "preface"
    assert context["call-1"]["segments"][1]["id"] == "call-1"
    assert context["call-2"]["segments"][0]["content"] == "between calls"
    assert context["call-2"]["segments"][1]["call"]["id"] == "call-2"
    assert residual == []


def test_append_reasoning_segment_merges_adjacent_text() -> None:
    segments = [{"type": "text", "content": "Hello"}]
    ChatService._append_reasoning_segment(segments, {"type": "text", "text": " world"})

    assert len(segments) == 1
    assert segments[0]["text"] == "Hello world"

    ChatService._append_reasoning_segment(
        segments,
        {"type": "text", "text": "!", "id": "call-2"},
    )

    assert len(segments) == 2
    assert segments[1]["text"] == "!"
