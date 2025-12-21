from __future__ import annotations

from collections.abc import Generator
from types import SimpleNamespace
from typing import Any, Dict, List, Tuple
from unittest.mock import Mock

import pytest

from app.schemas.chat import ChatMessageCreate
from app.services.chat import ChatService


class _StubOpenRouter:
    def __init__(self, chunks: List[Dict[str, Any]]) -> None:
        self._chunks = chunks
        self.calls: List[Dict[str, Any]] = []

    def chat_stream(
        self,
        *,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        model: str,
        parallel_tool_calls: bool,
        extra_body: Dict[str, Any],
        parameters: Dict[str, Any] | None,
    ) -> Generator[Dict[str, Any], None, None]:
        self.calls.append(
            {
                "messages": messages,
                "tools": tools,
                "model": model,
                "parallel_tool_calls": parallel_tool_calls,
                "extra_body": extra_body,
                "parameters": parameters,
            }
        )
        for chunk in self._chunks:
            yield chunk


def _collect_stream_results(gen: Generator[Dict[str, Any], None, Tuple[Dict[str, Any], Dict[str, Any], str, str, str]]) -> Tuple[List[Dict[str, Any]], Tuple[Dict[str, Any], Dict[str, Any], str, str, str]]:
    events: List[Dict[str, Any]] = []
    with pytest.raises(StopIteration) as stop_exc:
        while True:
            events.append(next(gen))
    return events, stop_exc.value.value


def test_stream_model_completion_yields_tokens_and_reasoning() -> None:
    chunks = [
        {
            "provider": "router-a",
            "model": "openrouter/test-model",
            "choices": [
                {
                    "delta": {
                        "content": [
                            {"type": "output_text", "text": "Hello"},
                        ],
                        "reasoning": [
                            {"type": "text", "content": "thinking out loud"},
                        ],
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call-1",
                                "function": {
                                    "name": "pinecone_query",
                                    "arguments": '{"query":"doc',
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 11},
        },
        {
            "provider": "router-a",
            "model": "openrouter/test-model",
            "choices": [
                {
                    "delta": {
                        "content": " world",
                        "tool_calls": [
                            {
                                "index": 0,
                                "function": {
                                    "arguments": 's","top_k":3}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"completion_tokens": 7, "total_tokens": 18},
        },
    ]
    stub = _StubOpenRouter(chunks)
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.openrouter = stub  # type: ignore[attr-defined]

    gen = service._stream_model_completion(  # type: ignore[attr-defined]
        messages=[{"role": "system", "content": "be helpful"}],
        tools=[{"type": "function", "function": {"name": "pinecone_query"}}],
        model="openrouter/test-model",
        extra_body={"usage": {"include": True}},
        parameters={"temperature": 0},
    )

    events, result = _collect_stream_results(gen)
    message, usage, provider, finish_reason, response_model = result

    assert [event["content"] for event in events if event["type"] == "token"] == ["Hello", " world"]
    reasoning_events = [event for event in events if event["type"] == "reasoning"]
    assert reasoning_events and reasoning_events[0]["segments"][0]["content"] == "thinking out loud"
    assert message["content"] == "Hello world"
    assert message["tool_calls"][0]["function"]["name"] == "pinecone_query"
    assert message["tool_calls"][0]["function"]["arguments"] == '{"query":"docs","top_k":3}'
    assert usage == {"completion_tokens": 7, "total_tokens": 18}
    assert provider == "router-a"
    assert finish_reason == "stop"
    assert response_model == "openrouter/test-model"
    assert stub.calls and stub.calls[0]["model"] == "openrouter/test-model"


def test_stream_model_completion_orders_tool_calls_by_index() -> None:
    chunks = [
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 1,
                                "id": "call-b",
                                "function": {"name": "pinecone_query", "arguments": '{"query":"two"}'},
                            }
                        ]
                    }
                }
            ],
        },
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call-a",
                                "function": {"name": "pinecone_query", "arguments": '{"query":"one"}'},
                            }
                        ],
                        "content": [{"text": "done"}],
                    },
                    "finish_reason": "stop",
                }
            ],
            "provider": "router-b",
            "model": "openrouter/second",
            "usage": {"total_tokens": 3},
        },
    ]
    stub = _StubOpenRouter(chunks)
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.openrouter = stub  # type: ignore[attr-defined]

    gen = service._stream_model_completion(  # type: ignore[attr-defined]
        messages=[],
        tools=[],
        model="openrouter/second",
        extra_body={},
        parameters=None,
    )
    events, result = _collect_stream_results(gen)
    message, usage, provider, finish_reason, response_model = result

    assert [event for event in events if event["type"] == "token"][0]["content"] == "done"
    call_ids = [call["id"] for call in message["tool_calls"]]
    assert call_ids == ["call-a", "call-b"]
    assert provider == "router-b"
    assert finish_reason == "stop"
    assert response_model == "openrouter/second"
    assert usage == {"total_tokens": 3}


class _StubChatRepo:
    def list_messages(self, session_id: object) -> List[Dict[str, Any]]:
        return []

    def add_message(self, message: object) -> None:
        return

    def delete_messages_after(self, *args: object, **kwargs: object) -> None:
        return

    def get_last_user_message_before(self, *args: object, **kwargs: object) -> None:
        return None

    def delete_tool_messages_since(self, *args: object, **kwargs: object) -> None:
        return


def test_stream_message_records_partial_on_abort() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id="session-x", chat_model="openrouter/test", updated_at=None)
    service.chat_repo = _StubChatRepo()
    service.session = SimpleNamespace(add=lambda *args, **kwargs: None, commit=lambda: None, flush=lambda: None)
    service.reasoning_effort = None
    service._ensure_session = lambda **kwargs: session_model
    service.openrouter = SimpleNamespace(
        get_model=lambda model_name: SimpleNamespace(
            supported_parameters=["tools"],
            context_length=4096,
        )
    )
    service.retrieval = SimpleNamespace()
    partial_recorder = Mock()
    service._record_partial_assistant_message = partial_recorder

    def fake_stream(*args: Any, **kwargs: Any) -> Generator[Dict[str, Any], None, Tuple]:
        yield {"type": "token", "content": "Hello"}
        yield {"type": "reasoning", "segments": [{"type": "text", "content": "thinking"}]}
        while True:
            yield {}

    service._stream_model_completion = fake_stream  # type: ignore[attr-defined]

    collection = SimpleNamespace(
        id="collection-x",
        name="Test Collection",
        description="Just testing",
        embedding_model="embed-model",
        chat_model="openrouter/test",
        context_window=8192,
        chunk_strategy="token",
        chunk_size=256,
        chunk_overlap=32,
        pinecone_index="idx",
        pinecone_namespace="ns",
        extra_metadata={},
    )

    user = SimpleNamespace(id="user-x", email="tester@example.com", full_name="Tester")
    payload = ChatMessageCreate(content="Truncate me", stream=True)
    stream_gen = service.stream_message(user=user, collection=collection, payload=payload)

    assert next(stream_gen)["type"] == "token"
    assert next(stream_gen)["type"] == "reasoning"

    stream_gen.close()

    partial_recorder.assert_called_once_with(
        session_model=session_model,
        content="Hello",
        reasoning_segments=[{"type": "text", "content": "thinking"}],
        model="openrouter/test",
    )
