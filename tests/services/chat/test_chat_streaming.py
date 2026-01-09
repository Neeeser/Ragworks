from __future__ import annotations

from collections.abc import Generator
from types import SimpleNamespace
from typing import Any, Dict, List, Tuple
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.schemas.chat import ChatMessageCreate
from app.services import chat as chat_module
from app.chat.service import ChatService
from app.chat import service as chat_service_module
from app.chat.providers.base import ChatRequest, ParsedStreamChunk
from app.chat.providers.openrouter import OpenRouterProvider
from app.chat.persistence.records import RecordContext
from app.chat.streaming.streaming import stream_model_completion


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
    provider = OpenRouterProvider(stub)

    request = ChatRequest(
        messages=[{"role": "system", "content": "be helpful"}],
        tools=[{"type": "function", "function": {"name": "pinecone_query"}}],
        model="openrouter/test-model",
        extra_body={"usage": {"include": True}},
        parameters={"temperature": 0},
    )
    gen = stream_model_completion(provider=provider, request=request)

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
    provider = OpenRouterProvider(stub)

    request = ChatRequest(
        messages=[],
        tools=[],
        model="openrouter/second",
        extra_body={},
        parameters=None,
    )
    gen = stream_model_completion(provider=provider, request=request)
    events, result = _collect_stream_results(gen)
    message, usage, provider, finish_reason, response_model = result

    assert [event for event in events if event["type"] == "token"][0]["content"] == "done"
    call_ids = [call["id"] for call in message["tool_calls"]]
    assert call_ids == ["call-a", "call-b"]
    assert provider == "router-b"
    assert finish_reason == "stop"
    assert response_model == "openrouter/second"
    assert usage == {"total_tokens": 3}


def test_openrouter_provider_ignores_non_dict_chunks() -> None:
    stub = SimpleNamespace(chat_stream=lambda **_kwargs: iter([]), get_model=lambda *_args: None)
    provider = OpenRouterProvider(stub)

    assert provider.parse_stream_chunk("bad") is None


def test_stream_model_completion_handles_empty_deltas() -> None:
    class _StubProvider:
        name = "router"

        def chat_stream(self, _request: ChatRequest):
            return iter([{"chunk": "ok"}])

        def parse_stream_chunk(self, _chunk: dict):
            return ParsedStreamChunk(
                provider=None,
                response_model=None,
                finish_reason=None,
                delta_content="hi",
                tool_calls=None,
                reasoning=None,
                usage=None,
            )

    provider = _StubProvider()
    request = ChatRequest(messages=[], tools=None, model="model", extra_body=None, parameters=None)

    events, result = _collect_stream_results(stream_model_completion(provider=provider, request=request))
    message, usage, provider_name, finish_reason, response_model = result

    assert [event["content"] for event in events if event["type"] == "token"] == ["hi"]
    assert message["content"] == "hi"
    assert usage == {}
    assert provider_name == "router"
    assert finish_reason is None
    assert response_model is None


def test_stream_model_completion_skips_empty_reasoning_updates() -> None:
    class _StubProvider:
        name = "router"

        def chat_stream(self, _request: ChatRequest):
            return iter([{"chunk": "ok"}])

        def parse_stream_chunk(self, _chunk: dict):
            return ParsedStreamChunk(
                provider="router",
                response_model=None,
                finish_reason=None,
                delta_content=None,
                tool_calls=None,
                reasoning=[" "],
                usage=None,
            )

    provider = _StubProvider()
    request = ChatRequest(messages=[], tools=None, model="model", extra_body=None, parameters=None)

    events, result = _collect_stream_results(stream_model_completion(provider=provider, request=request))
    message, usage, provider_name, finish_reason, response_model = result

    assert events == []
    assert message["content"] == ""
    assert usage == {}
    assert provider_name == "router"
    assert finish_reason is None
    assert response_model is None


def test_stream_model_completion_falls_back_on_invalid_chunks(monkeypatch) -> None:
    def _raise_validation(_chunk: object):
        raise ValidationError.from_exception_data("OpenRouterStreamChunk", [])

    monkeypatch.setattr(chat_module.OpenRouterStreamChunk, "model_validate", _raise_validation)

    chunks = [
        "skip",
        {"choices": []},
        {
            "provider": "router-c",
            "model": "fallback-model",
            "choices": [
                {
                    "delta": {
                        "content": "Hi",
                        "reasoning": [{"type": "text", "content": "fallback"}],
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call-1",
                                "function": {
                                    "name": "pinecone_query",
                                    "arguments": '{"query":"docs"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"total_tokens": 2},
        },
    ]
    stub = _StubOpenRouter(chunks)
    provider = OpenRouterProvider(stub, stream_chunk_model=chat_module.OpenRouterStreamChunk)

    request = ChatRequest(
        messages=[],
        tools=[],
        model="fallback-model",
        extra_body={},
        parameters=None,
    )
    gen = stream_model_completion(provider=provider, request=request)
    events, result = _collect_stream_results(gen)
    message, usage, provider, finish_reason, response_model = result

    assert any(event["type"] == "reasoning" for event in events)
    assert message["content"] == "Hi"
    assert message["tool_calls"][0]["function"]["name"] == "pinecone_query"
    assert usage == {"total_tokens": 2}
    assert provider == "router-c"
    assert finish_reason == "stop"
    assert response_model == "fallback-model"


def test_stream_model_completion_skips_tool_calls_without_name() -> None:
    chunks = [
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {"index": 0, "function": {"arguments": '{"query":"docs"}'}},
                        ]
                    }
                }
            ]
        }
    ]
    stub = _StubOpenRouter(chunks)
    provider = OpenRouterProvider(stub)

    request = ChatRequest(
        messages=[],
        tools=[],
        model="test-model",
        extra_body={},
        parameters=None,
    )
    gen = stream_model_completion(provider=provider, request=request)
    _events, result = _collect_stream_results(gen)
    message, _usage, _provider, _finish_reason, _response_model = result

    assert "tool_calls" not in message


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

    def list_session_collection_ids(self, *args: object, **kwargs: object) -> List[Any]:
        return []


def _stub_pipeline_helpers(monkeypatch, *, chat_model: str, context_window: int) -> None:
    class _StubPipelineService:
        def __init__(self, _session) -> None:
            pass

        def ensure_default_pipelines(self, _user):
            return SimpleNamespace(
                ingestion=SimpleNamespace(id="ingestion"),
                retrieval=SimpleNamespace(id="retrieval"),
            )

        def ensure_collection_pipelines(self, collection, defaults):
            collection.ingestion_pipeline_id = (
                getattr(collection, "ingestion_pipeline_id", None) or defaults.ingestion.id
            )
            collection.retrieval_pipeline_id = (
                getattr(collection, "retrieval_pipeline_id", None) or defaults.retrieval.id
            )
            return collection

        def get_pipeline(self, pipeline_id, _user_id):
            return SimpleNamespace(id=pipeline_id)

        def get_definition(self, _pipeline):
            return SimpleNamespace(nodes=[])

    ingestion_settings = SimpleNamespace(
        chunk_strategy="token",
        chunk_size=256,
        chunk_overlap=32,
        embedding_model="embed-model",
        index_name="idx",
        namespace="ns",
        dimension=128,
        metric="cosine",
    )
    retrieval_settings = SimpleNamespace(
        embedding_model="embed-model",
        index_name="idx",
        namespace="ns",
        dimension=128,
        metric="cosine",
        chat_model=chat_model,
        context_window=context_window,
    )

    monkeypatch.setattr(chat_service_module, "PipelineService", _StubPipelineService)
    monkeypatch.setattr(
        chat_service_module,
        "resolve_ingestion_settings",
        lambda *_args, **_kwargs: ingestion_settings,
    )
    monkeypatch.setattr(
        chat_service_module,
        "resolve_retrieval_settings",
        lambda *_args, **_kwargs: retrieval_settings,
    )


def test_stream_message_records_partial_on_abort(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id="session-x", chat_model="openrouter/test", updated_at=None)
    service.chat_repo = _StubChatRepo()
    service.session = SimpleNamespace(add=lambda *args, **kwargs: None, commit=lambda: None, flush=lambda: None)
    service.reasoning_effort = None
    service.settings = SimpleNamespace(
        default_chat_model="openrouter/test",
        openrouter_reasoning_effort=None,
    )
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    service.openrouter = SimpleNamespace(
        get_model=lambda model_name: SimpleNamespace(
            supported_parameters=["tools"],
            context_length=4096,
        )
    )
    service.retrieval = SimpleNamespace()
    partial_recorder = Mock()
    monkeypatch.setattr(chat_service_module, "record_partial_assistant_message", partial_recorder)
    _stub_pipeline_helpers(monkeypatch, chat_model="openrouter/test", context_window=8192)

    def fake_stream(*args: Any, **kwargs: Any) -> Generator[Dict[str, Any], None, Tuple]:
        yield {"type": "token", "content": "Hello"}
        yield {"type": "reasoning", "segments": [{"type": "text", "content": "thinking"}]}
        while True:
            yield {}

    monkeypatch.setattr(chat_service_module, "stream_model_completion", fake_stream)

    user = SimpleNamespace(
        id="user-x",
        email="tester@example.com",
        full_name="Tester",
        system_prompt_template=None,
    )
    payload = ChatMessageCreate(content="Truncate me", stream=True)
    stream_gen = service.stream_message(user=user, payload=payload)

    assert next(stream_gen)["type"] == "token"
    assert next(stream_gen)["type"] == "reasoning"

    stream_gen.close()

    partial_recorder.assert_called_once_with(
        context=RecordContext(session=service.session, chat_repo=service.chat_repo),
        session_model=session_model,
        content="Hello",
        reasoning_segments=[{"type": "text", "content": "thinking"}],
        model="openrouter/test",
    )
