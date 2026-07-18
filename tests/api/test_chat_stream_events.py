"""SSE wire-contract byte-identity guard for `app/chat/events.py`.

`format_event` in `app/api/routes/chat.py` encodes each stream event as
`data: {json}\\n\\n` via `jsonable_encoder` + `json.dumps`. This test freezes
the exact dict shapes `ChatService`/`streaming.py` produced before Task 4.1
(hand-transcribed from their literal dict construction, captured *before*
the event dicts were converted to `ChatStreamEvent` models) and proves the
new typed models serialize to byte-identical SSE frames for a token /
reasoning / tool_call / tool_result / final / error sequence.
"""

from __future__ import annotations

import json
from uuid import uuid4

from fastapi.encoders import jsonable_encoder
from pydantic import TypeAdapter

from app.chat.events import (
    ChatStreamEvent,
    ErrorEvent,
    FinalEvent,
    ReasoningEvent,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from app.chat.messages import AssistantMessage, FunctionCall, ProviderMessage, ToolCall
from app.schemas.retrieval import CollectionQueryResponse


def _format_event(data: object) -> str:
    """Mirror `app/api/routes/chat.py::format_event` exactly."""
    serialized = jsonable_encoder(data)
    return f"data: {json.dumps(serialized)}\n\n"


def test_token_event_is_byte_identical_to_legacy_dict() -> None:
    legacy = {"type": "token", "content": "Hello"}
    typed = TokenEvent(content="Hello").model_dump()

    assert _format_event(typed) == _format_event(legacy)


def test_reasoning_event_is_byte_identical_to_legacy_dict() -> None:
    segments = [{"type": "text", "content": "thinking", "text": "thinking"}]
    legacy = {"type": "reasoning", "segments": segments}
    typed = ReasoningEvent(segments=segments).model_dump()

    assert _format_event(typed) == _format_event(legacy)


def test_tool_call_event_is_byte_identical_to_legacy_dict() -> None:
    collection_id = str(uuid4())
    legacy = {
        "type": "tool_call",
        "id": "call-1",
        "name": "pinecone_query",
        "arguments": {"query": "docs", "top_k": 5},
        "reasoning": {"segments": [{"type": "text", "content": "why"}]},
        "collection_id": collection_id,
        "collection_name": "Docs",
    }
    typed = ToolCallEvent(
        id="call-1",
        name="pinecone_query",
        arguments={"query": "docs", "top_k": 5},
        reasoning={"segments": [{"type": "text", "content": "why"}]},
        collection_id=collection_id,
        collection_name="Docs",
    ).model_dump()

    assert list(typed.keys()) == list(legacy.keys())
    assert _format_event(typed) == _format_event(legacy)


def test_tool_result_event_is_byte_identical_to_legacy_dict() -> None:
    collection_id = str(uuid4())
    response = CollectionQueryResponse(query="docs", top_k=5, chunks=[], usage={"total_tokens": 3})
    legacy = {
        "type": "tool_result",
        "id": "call-1",
        "name": "pinecone_query",
        "arguments": {"query": "docs"},
        "response": response,
        "error": None,
        "reasoning": None,
        "collection_id": collection_id,
        "collection_name": "Docs",
    }
    typed = ToolResultEvent(
        id="call-1",
        name="pinecone_query",
        arguments={"query": "docs"},
        response=response,
        reasoning=None,
        collection_id=collection_id,
        collection_name="Docs",
    ).model_dump()

    assert list(typed.keys()) == list(legacy.keys())
    assert _format_event(typed) == _format_event(legacy)


def test_final_event_is_byte_identical_to_legacy_dict() -> None:
    payload = {"session": {"id": str(uuid4())}, "usage": {"total_tokens": 4}}
    legacy = {"type": "final", "payload": payload}
    typed = FinalEvent(payload=payload).model_dump()

    assert _format_event(typed) == _format_event(legacy)


def test_error_event_is_byte_identical_to_legacy_dict() -> None:
    legacy = {"type": "error", "message": "boom"}
    typed = ErrorEvent(message="boom").model_dump()

    assert _format_event(typed) == _format_event(legacy)


def test_full_event_sequence_is_byte_identical() -> None:
    """A token/reasoning/tool_call/tool_result/final/error sequence, end to end."""
    response = CollectionQueryResponse(query="docs", top_k=3, chunks=[], usage={})
    sequence = [
        ({"type": "token", "content": "Hi"}, TokenEvent(content="Hi")),
        (
            {
                "type": "reasoning",
                "segments": [{"type": "text", "content": "why", "text": "why"}],
            },
            ReasoningEvent(segments=[{"type": "text", "content": "why", "text": "why"}]),
        ),
        (
            {
                "type": "tool_call",
                "id": "call-1",
                "name": "pinecone_query",
                "arguments": {"query": "docs"},
                "reasoning": None,
                "collection_id": "col-1",
                "collection_name": "Docs",
            },
            ToolCallEvent(
                id="call-1",
                name="pinecone_query",
                arguments={"query": "docs"},
                reasoning=None,
                collection_id="col-1",
                collection_name="Docs",
            ),
        ),
        (
            {
                "type": "tool_result",
                "id": "call-1",
                "name": "pinecone_query",
                "arguments": {"query": "docs"},
                "response": response,
                "error": None,
                "reasoning": None,
                "collection_id": "col-1",
                "collection_name": "Docs",
            },
            ToolResultEvent(
                id="call-1",
                name="pinecone_query",
                arguments={"query": "docs"},
                response=response,
                reasoning=None,
                collection_id="col-1",
                collection_name="Docs",
            ),
        ),
        ({"type": "final", "payload": {"ok": True}}, FinalEvent(payload={"ok": True})),
        ({"type": "error", "message": "boom"}, ErrorEvent(message="boom")),
    ]

    for legacy, typed in sequence:
        assert _format_event(typed.model_dump()) == _format_event(legacy)
        # Every event in the sequence must also validate back through the
        # discriminated union — proof `ChatStreamEvent` actually covers it.
        TypeAdapter(ChatStreamEvent).validate_python(typed.model_dump())


def test_provider_message_union_round_trips_assistant_tool_calls() -> None:
    """Sanity check for the messages.py vocabulary (not yet wired into the service)."""
    message: ProviderMessage = AssistantMessage(
        content="",
        tool_calls=[
            ToolCall(id="call-1", function=FunctionCall(name="pinecone_query", arguments="{}"))
        ],
    )
    dumped = TypeAdapter(ProviderMessage).dump_python(message, mode="json")

    assert dumped["role"] == "assistant"
    assert dumped["tool_calls"][0]["function"]["name"] == "pinecone_query"
