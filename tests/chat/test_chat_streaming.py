from __future__ import annotations

from collections.abc import Generator
from types import SimpleNamespace
from typing import Any

from pydantic import ValidationError

from app.chat.streaming import StreamOutcome, stream_model_completion
from app.providers.chat.base import ChatRequest, ParsedStreamChunk
from app.providers.chat.openrouter import OpenRouterProvider
from app.schemas.openrouter import OpenRouterStreamChunk


class _StubOpenRouter:
    def __init__(self, chunks: list[dict[str, Any]]) -> None:
        self._chunks = chunks
        self.calls: list[dict[str, Any]] = []

    def chat_stream(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str,
        parallel_tool_calls: bool,
        extra_body: dict[str, Any],
        parameters: dict[str, Any] | None,
    ) -> Generator[OpenRouterStreamChunk, None, None]:
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
        # `__init__` (not `model_validate`) so tests that monkeypatch
        # `OpenRouterStreamChunk.model_validate` to simulate the *provider's*
        # own re-validation failing don't also break this stub's simulation of
        # the (already-validated) client boundary.
        for chunk in self._chunks:
            yield OpenRouterStreamChunk(**chunk)


def _collect_stream_results(
    gen: Generator[dict[str, Any], None, StreamOutcome],
) -> tuple[list[dict[str, Any]], StreamOutcome]:
    events: list[dict[str, Any]] = []
    try:
        while True:
            events.append(next(gen))
    except StopIteration as stop_exc:
        return events, stop_exc.value


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
        parameters={"temperature": 0},
    )
    gen = stream_model_completion(provider=provider, request=request)

    events, result = _collect_stream_results(gen)
    message, usage, provider = result.message, result.usage, result.provider
    finish_reason, response_model = result.finish_reason, result.response_model

    assert [event["content"] for event in events if event["type"] == "token"] == ["Hello", " world"]
    reasoning_events = [event for event in events if event["type"] == "reasoning"]
    assert reasoning_events
    assert reasoning_events[0]["segments"][0]["content"] == "thinking out loud"
    assert message["content"] == "Hello world"
    assert message["tool_calls"][0]["function"]["name"] == "pinecone_query"
    assert message["tool_calls"][0]["function"]["arguments"] == '{"query":"docs","top_k":3}'
    assert usage == {"completion_tokens": 7, "total_tokens": 18}
    assert provider == "router-a"
    assert finish_reason == "stop"
    assert response_model == "openrouter/test-model"
    assert stub.calls
    assert stub.calls[0]["model"] == "openrouter/test-model"


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
        parameters=None,
    )
    gen = stream_model_completion(provider=provider, request=request)
    events, result = _collect_stream_results(gen)
    message, usage, provider = result.message, result.usage, result.provider
    finish_reason, response_model = result.finish_reason, result.response_model

    assert next(event for event in events if event["type"] == "token")["content"] == "done"
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
    request = ChatRequest(messages=[], tools=None, model="model", parameters=None)

    events, result = _collect_stream_results(stream_model_completion(provider=provider, request=request))
    message, usage, provider_name = result.message, result.usage, result.provider
    finish_reason, response_model = result.finish_reason, result.response_model

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
    request = ChatRequest(messages=[], tools=None, model="model", parameters=None)

    events, result = _collect_stream_results(stream_model_completion(provider=provider, request=request))
    message, usage, provider_name = result.message, result.usage, result.provider
    finish_reason, response_model = result.finish_reason, result.response_model

    assert events == []
    assert message["content"] == ""
    assert usage == {}
    assert provider_name == "router"
    assert finish_reason is None
    assert response_model is None


def test_stream_model_completion_falls_back_on_invalid_chunks(monkeypatch) -> None:
    def _raise_validation(_chunk: object):
        raise ValidationError.from_exception_data("OpenRouterStreamChunk", [])

    monkeypatch.setattr(OpenRouterStreamChunk, "model_validate", _raise_validation)

    # `_StubOpenRouter.chat_stream` now simulates the typed client boundary (it
    # always yields `OpenRouterStreamChunk` instances, never a bare string) --
    # non-dict/malformed chunks reaching `parse_stream_chunk` are covered
    # directly by `test_openrouter_provider_ignores_non_dict_chunks` instead.
    chunks = [
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
    provider = OpenRouterProvider(stub, stream_chunk_model=OpenRouterStreamChunk)

    request = ChatRequest(
        messages=[],
        tools=[],
        model="fallback-model",
        parameters=None,
    )
    gen = stream_model_completion(provider=provider, request=request)
    events, result = _collect_stream_results(gen)
    message, usage, provider = result.message, result.usage, result.provider
    finish_reason, response_model = result.finish_reason, result.response_model

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
        parameters=None,
    )
    gen = stream_model_completion(provider=provider, request=request)
    _events, result = _collect_stream_results(gen)
    message, _usage, _provider, _finish_reason, _response_model = result

    assert "tool_calls" not in message



# `test_stream_message_records_partial_on_abort` was re-homed to
# tests/chat/test_chat_service_flow.py as a real-DB flow test
# (`test_stream_message_persists_partial_on_client_disconnect`). The old
# version constructed `ChatService` via `__new__` and monkeypatched module
# globals that Task 4.2 moved into `app.chat.run_loop`; the flow-harness
# version drives the real `stream_message`, closes the generator mid-stream,
# and asserts the persisted partial message row (a stronger, layout-agnostic
# assertion than a mock-call check).
