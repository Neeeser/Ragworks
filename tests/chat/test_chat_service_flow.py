from __future__ import annotations

from typing import Any

import pytest
from sqlmodel import Session

from app.chat import model_settings as chat_model_settings_module
from app.chat import run_loop as chat_run_loop
from app.chat import service as service_module
from app.chat.service import ChatService
from app.chat.state import RunState, ToolExecutionContext
from app.chat.streaming import StreamOutcome
from app.chat.tool_calls import normalize_tool_calls
from app.chat.tools import ToolExecutor
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageCreate
from app.schemas.models import ModelInfo
from app.schemas.openrouter import OpenRouterChatResponse
from app.schemas.tools import ToolInvocationResponse
from app.services.errors import InvalidInputError
from tests.chat.conftest import (
    ModelOnlyOpenRouter,
    SequencedOpenRouter,
    StubInvocationService,
    StubOpenRouter,
    StubSettings,
    make_tool_context,
    stub_resolver_class,
    tool_model_info,
    wrap_tool_contexts,
)


def _only_session_id(session: Session, user: models.User) -> Any:
    """Return the id of the single chat session created for a user in a flow test."""
    sessions = ChatRepository(session).list_sessions(user_id=user.id)
    assert len(sessions) == 1
    return sessions[0].id


def test_collection_tool_spec_includes_collection_description(
    chat_user, make_collection
) -> None:
    collection = make_collection(chat_user, name="Evaluation Papers")
    collection.description = "Peer-reviewed evaluation results and methods."

    tools, _ = ToolExecutor.specs(
        [
            wrap_tool_contexts(
                collection,
                make_tool_context(collection, tool_name="search_evaluation_papers"),
            )
        ]
    )

    description = tools[0]["function"]["description"]
    assert description == (
        "Search the document collection 'Evaluation Papers'. "
        "Peer-reviewed evaluation results and methods. "
        "Always call this tool before answering questions about documents in this collection."
    )


def test_send_message_records_response(
    session: Session, chat_user, make_collection, install_chat_flow
) -> None:
    collection = make_collection(chat_user)
    model_info = ModelInfo(
        id="test-model",
        name="Test Model",
        context_length=2048,
        supported_parameters=["tools", "reasoning"],
    )
    response = {
        "id": "resp-1",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": "Answer",
                    "reasoning": [{"type": "text", "content": "thinking"}],
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 3,
            "completion_tokens": 5,
            "total_tokens": 8,
            "reasoning_tokens": 2,
            "cost": "0.01",
        },
    }
    openrouter = StubOpenRouter(model_info=model_info, response=response)
    install_chat_flow(openrouter=openrouter, chat_model="test-model")

    service = ChatService(session)
    payload = ChatMessageCreate(content="hello", tool_collection_ids=[collection.id])

    result = service.send_message(user=chat_user, payload=payload)

    assert result.provider == "openrouter"
    assert result.messages[-1].content == "Answer"
    assert result.usage["total_tokens"] == 8
    assert openrouter.chat_calls


def test_send_message_handles_tool_calls(
    session: Session, chat_user, make_collection, monkeypatch, stub_pipeline_settings
) -> None:
    collection = make_collection(chat_user)
    model_info = tool_model_info()
    responses = [
        {
            "id": "resp-1",
            "provider": "openrouter",
            "model": "tool-model",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "content": "Calling tool",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "pinecone_query",
                                    "arguments": '{"query": "docs", "top_k": 2}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        },
        {
            "id": "resp-2",
            "provider": "openrouter",
            "model": "tool-model",
            "choices": [
                {
                    "index": 0,
                    "message": {"content": "Final answer"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
        },
    ]
    openrouter = SequencedOpenRouter(model_info=model_info, responses=responses)

    class _TrackingRetrievalService(StubInvocationService):
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def invoke_binding(  # pylint: disable=too-many-arguments,too-many-positional-arguments
            self,
            _user: models.User,
            collection: models.Collection,
            binding_id,
            query: str,
            top_k: int | None = None,
            arguments: dict[str, object] | None = None,
        ) -> ToolInvocationResponse:
            self.calls.append({"collection": collection, "query": query, "top_k": top_k})
            return ToolInvocationResponse(
                kind="chunks",
                tool_binding_id=binding_id,
                query=query,
                top_k=top_k or 5,
                chunks=[],
                usage={},
            )

    retrieval = _TrackingRetrievalService()
    monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings())
    monkeypatch.setattr(chat_model_settings_module, "ProviderResolver", stub_resolver_class(openrouter))
    monkeypatch.setattr(service_module, "ToolInvocationService", lambda *_a, **_k: retrieval)
    stub_pipeline_settings(chat_model="tool-model")

    service = ChatService(session)

    result = service.send_message(
        user=chat_user,
        payload=ChatMessageCreate(content="hi", tool_collection_ids=[collection.id]),
    )

    assert result.messages[-1].content == "Final answer"
    assert result.tool_traces[0].name == "pinecone_query"
    assert retrieval.calls[0]["top_k"] == 2
    # Usage is aggregated across both provider calls of the tool-calling turn
    # (1+2 prompt, 1+3 completion, 2+5 total), not just the final response.
    assert result.usage["prompt_tokens"] == 3
    assert result.usage["completion_tokens"] == 4
    assert result.usage["total_tokens"] == 7


def test_failed_tool_call_records_an_error_without_persisting_the_call(
    session: Session, chat_user, make_collection, monkeypatch, install_chat_flow
) -> None:
    """An unavailable tool is visible in history but never becomes provider context."""
    collection = make_collection(chat_user)
    response = {
        "id": "resp-1",
        "provider": "openrouter",
        "model": "tool-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "search_unknown_collection",
                                "arguments": '{"query": "docs"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }
    openrouter = StubOpenRouter(model_info=tool_model_info(), response=response)
    install_chat_flow(openrouter=openrouter, chat_model="tool-model")

    service = ChatService(session)
    with pytest.raises(InvalidInputError, match="does not match an enabled collection"):
        service.send_message(
            user=chat_user,
            payload=ChatMessageCreate(content="hi", tool_collection_ids=[collection.id]),
        )

    messages = ChatRepository(session).list_messages(_only_session_id(session, chat_user))
    assert [str(message.role) for message in messages] == ["user", "error"]
    assert messages[-1].content == "The model requested an unavailable collection tool."
    assert messages[-1].tool_payload is None


def test_normalize_tool_calls_backfills_missing_id_then_executes(
    session: Session, chat_user, make_collection
) -> None:
    """A provider tool call with no id is backfilled by `normalize_tool_calls`,
    and the resulting typed `ToolCall` executes end to end.

    (Retargeted from the Phase-0 regression against the deleted private
    `_execute_tool_calls`: the missing-id tolerance now lives in
    `normalize_tool_calls`, and `ToolExecutor.execute` consumes typed calls.)
    """
    collection = make_collection(chat_user)
    chat_session = models.ChatSession(
        user_id=chat_user.id,
        title="Tool session",
        chat_model="tool-model",
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)

    processed_ids: set[str] = set()
    tool_calls = normalize_tool_calls(
        [
            {
                "type": "function",
                "function": {"name": "pinecone_query", "arguments": '{"query": "docs"}'},
            }
        ],
        processed_ids,
    )
    assert len(tool_calls) == 1
    assert tool_calls[0].id.startswith("tool_call_")
    assert tool_calls[0].id in processed_ids

    executor = ToolExecutor(
        session=session,
        chat_repo=ChatRepository(session),
        invocation=StubInvocationService(),
    )
    run_state = RunState()
    context = ToolExecutionContext(
        user=chat_user,
        payload=ChatMessageCreate(content="hi", tool_collection_ids=[collection.id]),
        session_model=chat_session,
        messages=[],
        run_state=run_state,
        shared_tool_reasoning=None,
        tool_collection_map={"pinecone_query": make_tool_context(collection)},
    )

    # Non-streaming callers drain the iterator without forwarding.
    events = list(executor.execute(tool_calls=tool_calls, context=context))

    assert [event["type"] for event in events] == ["tool_call", "tool_result"]
    assert run_state.tool_traces[0].id == tool_calls[0].id
    assert run_state.tool_traces[0].name == "pinecone_query"
    tool_rows = [
        message
        for message in ChatRepository(session).list_messages(chat_session.id)
        if message.role == models.ChatRole.TOOL
    ]
    assert len(tool_rows) == 1
    assert tool_rows[0].tool_call_id == tool_calls[0].id


def test_stream_message_handles_tool_calls_and_final(
    session: Session, chat_user, make_collection, monkeypatch, stub_pipeline_settings
) -> None:
    collection = make_collection(chat_user)
    model_info = tool_model_info()

    retrieval_calls: list[dict[str, Any]] = []

    class _TrackingRetrievalService(StubInvocationService):
        def invoke_binding(  # pylint: disable=too-many-arguments,too-many-positional-arguments
            self,
            _user: models.User,
            collection: models.Collection,
            binding_id,
            query: str,
            top_k: int | None = None,
            arguments: dict[str, object] | None = None,
        ) -> ToolInvocationResponse:
            retrieval_calls.append({"collection": collection, "query": query, "top_k": top_k})
            return ToolInvocationResponse(
                kind="chunks",
                tool_binding_id=binding_id,
                query=query,
                top_k=top_k or 5,
                chunks=[],
                usage={},
            )

    def _make_stream(events, result):
        def _gen():
            yield from events
            return result

        return _gen()

    tool_message = {
        "content": "Calling tool",
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "pinecone_query", "arguments": '{"query": "docs", "top_k": 2}'},
            }
        ],
    }
    final_message = {"content": "Final answer"}

    stream_results = [
        {
            "events": [
                {"type": "token", "content": "Calling"},
                {"type": "reasoning", "segments": [{"type": "text", "content": "thinking"}]},
            ],
            "result": StreamOutcome(
                message=tool_message,
                usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                provider="openrouter",
                finish_reason="tool_calls",
                response_model="tool-model",
            ),
        },
        {
            "events": [{"type": "token", "content": "Final"}],
            "result": StreamOutcome(
                message=final_message,
                usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
                provider="openrouter",
                finish_reason="stop",
                response_model="tool-model",
            ),
        },
    ]

    def _stream_model_completion(**_kwargs):
        entry = stream_results.pop(0)
        return _make_stream(entry["events"], entry["result"])

    monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings())
    monkeypatch.setattr(
        chat_model_settings_module,
        "ProviderResolver",
        stub_resolver_class(ModelOnlyOpenRouter(model_info)),
    )
    monkeypatch.setattr(service_module, "ToolInvocationService", _TrackingRetrievalService)
    # stream_model_completion lives in the shared run loop, not the service.
    monkeypatch.setattr(chat_run_loop, "stream_model_completion", _stream_model_completion)
    stub_pipeline_settings(chat_model="tool-model")

    service = ChatService(session)

    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id])
    events = list(service.stream_message(user=chat_user, payload=payload))

    assert any(event.get("type") == "tool_call" for event in events if isinstance(event, dict))
    assert any(event.get("type") == "tool_result" for event in events if isinstance(event, dict))
    assert events[-1]["type"] == "final"
    assert retrieval_calls[0]["top_k"] == 2


def test_send_message_uses_reasoning_content_fallback_and_list_content(
    session: Session, chat_user, make_collection, install_chat_flow
) -> None:
    collection = make_collection(chat_user)
    model_info = tool_model_info("test-model", context_length=1024)
    response = {
        "id": "resp-1",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": [{"text": "Hello"}],
                    "reasoning_content": "because",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"total_tokens": 2},
    }
    openrouter = StubOpenRouter(model_info=model_info, response=response)
    install_chat_flow(openrouter=openrouter, chat_model="test-model")

    service = ChatService(session)
    payload = ChatMessageCreate(content="hello", tool_collection_ids=[collection.id])

    result = service.send_message(user=chat_user, payload=payload)

    assert result.messages[-1].content == '[{"text": "Hello"}]'
    assert result.usage["total_tokens"] == 2


def test_send_message_raises_when_model_never_stops_calling_tools(
    session: Session, chat_user, make_collection, monkeypatch, install_chat_flow
) -> None:
    """The real run loop must abort after MAX_TOOL_ITERATIONS if the model keeps calling tools."""
    collection = make_collection(chat_user)
    tool_response = {
        "id": "resp",
        "provider": "openrouter",
        "model": "tool-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": "Calling tool",
                    "tool_calls": [
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "pinecone_query",
                                "arguments": '{"query": "docs"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }

    class _AlwaysToolOpenRouter:
        def get_model(self, _model_id: str) -> ModelInfo:
            return tool_model_info()

        def chat(self, **_kwargs: Any) -> OpenRouterChatResponse:
            return OpenRouterChatResponse.model_validate(tool_response)

    install_chat_flow(openrouter=_AlwaysToolOpenRouter(), chat_model="tool-model")
    monkeypatch.setattr(chat_run_loop, "MAX_TOOL_ITERATIONS", 3)

    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id])

    with pytest.raises(RuntimeError, match="tool iteration limit"):
        service.send_message(user=chat_user, payload=payload)


def test_send_message_rejects_other_users_session(
    session: Session, chat_user, make_collection, install_chat_flow
) -> None:
    """A session_id owned by another user is rejected as not-found (no cross-user access)."""
    owner = chat_user
    other = models.User(
        email="other@example.com",
        full_name="Other",
        hashed_password="hashed",
        last_used_chat_model="test-model",
    )
    session.add(other)
    session.commit()
    session.refresh(other)
    for provider_type, config in (
        ("openrouter", {"api_key": "openrouter-key"}),
        ("pinecone", {"api_key": "pinecone-key"}),
    ):
        session.add(
            models.ProviderConnection(
                user_id=other.id,
                provider_type=provider_type,
                label=provider_type,
                config=config,
            )
        )
    session.commit()
    collection = make_collection(other)
    owned_session = models.ChatSession(user_id=owner.id, title="Owned", chat_model="test-model")
    session.add(owned_session)
    session.commit()
    session.refresh(owned_session)

    model_info = tool_model_info("test-model")
    response = {
        "id": "r",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [{"index": 0, "message": {"content": "A"}, "finish_reason": "stop"}],
        "usage": {"total_tokens": 1},
    }
    openrouter = StubOpenRouter(model_info=model_info, response=response)
    install_chat_flow(openrouter=openrouter, chat_model="test-model")

    service = ChatService(session)
    payload = ChatMessageCreate(
        content="hi", session_id=owned_session.id, tool_collection_ids=[collection.id]
    )

    with pytest.raises(InvalidInputError, match="Chat session not found"):
        service.send_message(user=other, payload=payload)


def _install_streaming_flow(monkeypatch, stub_pipeline_settings, *, stream_factory, invocation_cls):
    """Wire a streaming service flow with a fake `stream_model_completion` factory."""
    monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings())
    monkeypatch.setattr(
        chat_model_settings_module,
        "ProviderResolver",
        stub_resolver_class(ModelOnlyOpenRouter(tool_model_info())),
    )
    monkeypatch.setattr(service_module, "ToolInvocationService", invocation_cls)
    monkeypatch.setattr(chat_run_loop, "stream_model_completion", stream_factory)
    stub_pipeline_settings(chat_model="tool-model")


def test_stream_message_persists_partial_on_client_disconnect(
    session: Session, chat_user, make_collection, monkeypatch, stub_pipeline_settings
) -> None:
    """Closing the stream mid-token persists the partial assistant content + reasoning."""

    def _stream_forever(**_kwargs):
        def _gen():
            yield {"type": "token", "content": "Hello"}
            yield {"type": "reasoning", "segments": [{"type": "text", "content": "thinking"}]}
            while True:
                yield {"type": "token", "content": ""}

        return _gen()

    collection = make_collection(chat_user)
    _install_streaming_flow(
        monkeypatch,
        stub_pipeline_settings,
        stream_factory=_stream_forever,
        invocation_cls=StubInvocationService,
    )

    service = ChatService(session)
    payload = ChatMessageCreate(
        content="Truncate me", tool_collection_ids=[collection.id], stream=True
    )
    gen = service.stream_message(user=chat_user, payload=payload)

    assert next(gen)["type"] == "token"
    assert next(gen)["type"] == "reasoning"
    gen.close()

    messages = ChatRepository(session).list_messages(_only_session_id(session, chat_user))
    partials = [
        message
        for message in messages
        if message.role == models.ChatRole.ASSISTANT and message.content == "Hello"
    ]
    assert partials, "partial assistant content should persist on client disconnect"
    assert partials[0].reasoning_trace == {"segments": [{"type": "text", "content": "thinking"}]}


def test_stream_message_persists_partial_and_raises_on_provider_error(
    session: Session, chat_user, make_collection, monkeypatch, stub_pipeline_settings
) -> None:
    """A mid-stream provider exception persists the partial content and surfaces the error."""

    def _stream_boom(**_kwargs):
        def _gen():
            yield {"type": "token", "content": "Partial"}
            raise RuntimeError("provider exploded")
            yield {"type": "token", "content": "unreachable"}  # pragma: no cover

        return _gen()

    collection = make_collection(chat_user)
    _install_streaming_flow(
        monkeypatch,
        stub_pipeline_settings,
        stream_factory=_stream_boom,
        invocation_cls=StubInvocationService,
    )

    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id], stream=True)
    gen = service.stream_message(user=chat_user, payload=payload)

    assert next(gen)["type"] == "token"
    with pytest.raises(RuntimeError, match="provider exploded"):
        list(gen)

    messages = ChatRepository(session).list_messages(_only_session_id(session, chat_user))
    partials = [
        message
        for message in messages
        if message.role == models.ChatRole.ASSISTANT and message.content == "Partial"
    ]
    assert partials, "partial content must persist even when the provider fails mid-stream"


def test_stream_message_surfaces_retrieval_failure_without_losing_turn(
    session: Session, chat_user, make_collection, monkeypatch, stub_pipeline_settings
) -> None:
    """A retrieval failure during tool execution surfaces the error; the turn's history persists."""
    tool_message = {
        "content": "Calling tool",
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "pinecone_query", "arguments": '{"query": "docs"}'},
            }
        ],
    }

    def _stream_tool(**_kwargs):
        def _gen():
            yield {"type": "token", "content": "Calling"}
            return StreamOutcome(
                message=tool_message,
                usage={"total_tokens": 1},
                provider="openrouter",
                finish_reason="tool_calls",
                response_model="tool-model",
            )

        return _gen()

    class _BoomRetrieval(StubInvocationService):
        def invoke_binding(self, *args: object, **kwargs: object) -> ToolInvocationResponse:
            raise RuntimeError("pinecone down")

    collection = make_collection(chat_user)
    _install_streaming_flow(
        monkeypatch,
        stub_pipeline_settings,
        stream_factory=_stream_tool,
        invocation_cls=_BoomRetrieval,
    )

    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id], stream=True)
    gen = service.stream_message(user=chat_user, payload=payload)

    with pytest.raises(RuntimeError, match="pinecone down"):
        list(gen)

    messages = ChatRepository(session).list_messages(_only_session_id(session, chat_user))
    assistant_tool_messages = [
        message
        for message in messages
        if message.role == models.ChatRole.ASSISTANT
        and isinstance(message.tool_payload, dict)
        and "tool_calls" in message.tool_payload
    ]
    assert assistant_tool_messages, "the assistant tool-call turn must survive a retrieval failure"


def test_send_message_records_chat_turn_telemetry(
    session: Session, chat_user, make_collection, install_chat_flow
) -> None:
    """A completed turn writes one chat.turn_completed event with the usage."""
    from app.db.repositories import TelemetryRepository

    make_collection(chat_user)
    model_info = ModelInfo(
        id="test-model",
        name="Test Model",
        context_length=2048,
        supported_parameters=["tools", "reasoning"],
    )
    response = {
        "id": "resp-telemetry",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [
            {"index": 0, "message": {"content": "Answer"}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
    }
    install_chat_flow(
        openrouter=StubOpenRouter(model_info=model_info, response=response),
        chat_model="test-model",
    )

    ChatService(session).send_message(
        user=chat_user, payload=ChatMessageCreate(content="hello")
    )

    with Session(session.get_bind()) as fresh:
        rows = TelemetryRepository(fresh).list_by_type("chat.turn_completed")
    assert len(rows) == 1
    assert rows[0].user_id == chat_user.id
    assert rows[0].payload["total_tokens"] == 8
    assert rows[0].payload["model"] == "test-model"
