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
    tool_calls, context = ChatService._extract_reasoning_tool_calls(segments, set())

    assert len(tool_calls) == 1
    call = tool_calls[0]
    assert call["id"] == "call-1"
    assert call["function"]["name"] == "pinecone_query"
    args = ChatService._decode_tool_arguments(call["function"]["arguments"])
    assert args == {"query": "docs", "top_k": 7}
    assert "call-1" in context


def test_build_reasoning_options_honors_supported_parameters() -> None:
    supported = ["temperature", "include_reasoning", "reasoning"]
    options = ChatService._build_reasoning_options(supported, "high")

    assert options["include_reasoning"] is True
    assert options["reasoning"] == {"effort": "high"}
