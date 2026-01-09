from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from app.chat import service as chat_service_module
from app.chat.providers.base import ParsedChatResponse
from app.chat.service import ChatService, StreamCapture
from app.chat.state import (
    ChatSetup,
    ModelSettings,
    PipelineContext,
    ProviderResponse,
    RunState,
    StreamToolCallContext,
    ToolCallResolution,
)
from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.schemas.models import ModelInfo


def _build_setup() -> ChatSetup:
    model_info = ModelInfo(
        id="test-model",
        name="Test Model",
        context_length=1024,
        supported_parameters=["tools", "reasoning"],
    )
    model_settings = ModelSettings(
        active_model_name="test-model",
        model_info=model_info,
        supported_parameters=["tools", "reasoning"],
        parameter_overrides={},
        reasoning_options={"reasoning": {"effort": "medium"}},
        provider_preferences=None,
        context_window=1024,
    )
    pipeline = PipelineContext(
        ingestion_settings=SimpleNamespace(),
        retrieval_settings=SimpleNamespace(),
    )
    session_model = SimpleNamespace(id="session-1", context_tokens=0, updated_at=None, chat_model="model")
    return ChatSetup(
        session_model=session_model,
        messages=[],
        tools=[],
        tool_collections=[],
        tool_collection_map={},
        pipeline=pipeline,
        model=model_settings,
    )


def test_ensure_provider_returns_cached_provider() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    cached = SimpleNamespace(name="cached")
    service.provider = cached

    user = SimpleNamespace(openrouter_api_key="key")

    assert service._ensure_provider(user) is cached


def test_resolve_pipeline_context_requires_pipelines(monkeypatch) -> None:
    class _StubPipelineService:
        def __init__(self, _session: object) -> None:
            pass

        def ensure_default_pipelines(self, _user):
            return SimpleNamespace(
                ingestion=SimpleNamespace(id="ingestion"),
                retrieval=SimpleNamespace(id="retrieval"),
            )

        def ensure_collection_pipelines(self, *_args, **_kwargs):
            return None

        def get_pipeline(self, pipeline_id, _user_id):
            if pipeline_id == "retrieval":
                return None
            return SimpleNamespace(id=pipeline_id)

    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.session = SimpleNamespace()
    monkeypatch.setattr(chat_service_module, "PipelineService", _StubPipelineService)

    with pytest.raises(ValueError, match="Pipeline configuration could not be resolved"):
        service._resolve_pipeline_context(
            user=SimpleNamespace(id=uuid4()),
            collection=SimpleNamespace(ingestion_pipeline_id=None, retrieval_pipeline_id=None),
        )


def test_resolve_session_model_returns_edit_target() -> None:
    session_id = uuid4()
    collection_id = uuid4()
    edit_message = SimpleNamespace(session_id=session_id)
    session_model = SimpleNamespace(id=session_id, collection_id=collection_id)

    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.chat_repo = SimpleNamespace(
        get_message=lambda *_args, **_kwargs: edit_message,
        get_session=lambda *_args, **_kwargs: session_model,
    )

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())

    resolved_session, target = service._resolve_session_model(
        user=SimpleNamespace(id=uuid4()),
        payload=payload,
        default_chat_model="model",
        primary_collection_id=collection_id,
    )

    assert resolved_session is session_model
    assert target is edit_message


def test_apply_payload_to_session_calls_apply_edit(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.session = SimpleNamespace()
    service.chat_repo = SimpleNamespace()
    called = {}

    def _apply_edit(**kwargs):
        called.update(kwargs)

    monkeypatch.setattr(chat_service_module, "apply_edit", _apply_edit)

    service._apply_payload_to_session(
        session_model=SimpleNamespace(id=uuid4()),
        edit_target=SimpleNamespace(id=uuid4()),
        payload=ChatMessageCreate(content="edit me"),
    )

    assert called["new_content"] == "edit me"


def test_maybe_update_session_model_updates_and_flushes() -> None:
    session_model = SimpleNamespace(chat_model="old")
    session = SimpleNamespace(add=lambda *_args, **_kwargs: None, flush=lambda: None)

    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.session = session

    service._maybe_update_session_model(
        session_model=session_model,
        payload=ChatMessageCreate(content="hi", chat_model="new"),
    )

    assert session_model.chat_model == "new"


def test_build_reasoning_request_options_merges_override() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.reasoning_effort = "low"

    options = service._build_reasoning_request_options(
        supported_parameters=["reasoning"],
        reasoning_override={"effort": "high", "max_tokens": 7},
    )

    assert options["reasoning"]["effort"] == "high"
    assert options["reasoning"]["max_tokens"] == 7


def test_update_usage_aggregate_skips_empty_usage() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    run_state = RunState(provider="openrouter")
    run_state.usage_aggregate["prompt_tokens"] = 1

    service._update_usage_aggregate(run_state, {})

    assert run_state.usage_aggregate["prompt_tokens"] == 1


def test_resolve_tool_calls_updates_reasoning_context(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    run_state = RunState(provider="openrouter")

    tool_calls = [{"id": "call-1", "type": "function", "function": {"name": "tool", "arguments": "{}"}}]
    context = {"call-1": {"segments": [{"type": "text", "content": "thinking"}]}}

    monkeypatch.setattr(
        chat_service_module,
        "extract_reasoning_tool_calls",
        lambda *_args, **_kwargs: (tool_calls, context, []),
    )

    resolution = service._resolve_tool_calls(
        message={},
        run_state=run_state,
        combine_reasoning=True,
    )

    assert resolution.pending_tool_calls == tool_calls
    assert run_state.reasoning_call_segments["call-1"]["segments"][0]["content"] == "thinking"


def test_parse_tool_call_handles_non_dict_function() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    payload = ChatMessageCreate(content="query")

    call_id, name, _, query_text, top_k = service._parse_tool_call(
        {"function": "oops"},
        payload,
        use_fallback_id=False,
    )

    assert call_id is None
    assert name == "tool_call"
    assert query_text == "query"
    assert top_k == 5


def test_parse_tool_call_applies_fallback_and_top_k_defaults() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    payload = ChatMessageCreate(content="query")

    call_id, _, _, _, top_k = service._parse_tool_call(
        {"function": {"name": "pinecone_query", "arguments": {"top_k": "bad"}}},
        payload,
        use_fallback_id=True,
    )

    assert isinstance(call_id, str)
    assert call_id.startswith("tool_call_")
    assert top_k == 5


def test_build_reasoning_payload_wraps_segment() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    run_state = RunState(provider="openrouter")
    run_state.reasoning_call_segments["call-1"] = {"type": "text", "content": "reason"}

    payload = service._build_reasoning_payload(
        call_id="call-1",
        run_state=run_state,
        shared_tool_reasoning=None,
    )

    assert payload == {"segments": [{"type": "text", "content": "reason"}]}
    assert "call-1" not in run_state.reasoning_call_segments


def test_stream_tool_calls_if_needed_serializes_list_content() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()
    captured: dict[str, Any] = {}

    service._resolve_tool_calls = lambda **_kwargs: ToolCallResolution(
        pending_tool_calls=[{"id": "call-1", "type": "function", "function": {"name": "tool", "arguments": "{}"}}],
        shared_tool_reasoning=None,
    )

    def _append_tool_call_assistant_message(**kwargs):
        captured["assistant_content"] = kwargs["assistant_content"]

    def _stream_tool_calls(**_kwargs):
        if False:
            yield {}
        return None

    service._append_tool_call_assistant_message = _append_tool_call_assistant_message
    service._stream_tool_calls = _stream_tool_calls

    context = StreamToolCallContext(
        message={"content": ["a", "b"]},
        setup=setup,
        run_state=RunState(provider="openrouter"),
        user=SimpleNamespace(id=uuid4()),
        payload=ChatMessageCreate(content="hi"),
    )

    gen = service._stream_tool_calls_if_needed(context=context)

    with pytest.raises(StopIteration) as stop_exc:
        next(gen)

    assert stop_exc.value.value is True
    assert captured["assistant_content"] == json.dumps(["a", "b"])


def test_finalize_response_applies_usage_aggregate(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.session = SimpleNamespace(add=lambda *_args, **_kwargs: None, commit=lambda: None)
    service.chat_repo = SimpleNamespace()

    assistant_msg = SimpleNamespace(
        role=models.ChatRole.ASSISTANT,
        content="ok",
        tool_payload=None,
        tool_call_id=None,
    )

    monkeypatch.setattr(chat_service_module, "record_message", lambda *_args, **_kwargs: assistant_msg)
    monkeypatch.setattr(chat_service_module, "serialize_message", lambda *_args, **_kwargs: {"role": "assistant"})
    session_payload = {
        "id": uuid4(),
        "user_id": uuid4(),
        "title": "Session",
        "mode": models.ChatMode.CHAT,
        "chat_model": "model",
        "context_tokens": 0,
        "tool_collection_ids": [],
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    monkeypatch.setattr(chat_service_module, "convert_session", lambda *_args, **_kwargs: session_payload)
    monkeypatch.setattr(chat_service_module, "convert_messages", lambda *_args, **_kwargs: [])

    setup = _build_setup()
    run_state = RunState(provider="openrouter")
    run_state.latest_usage_payload = {"total_tokens": 4}
    run_state.usage_aggregate = {"prompt_tokens": 1, "total_tokens": 7, "cost": None}

    response = service._finalize_response(
        setup=setup,
        run_state=run_state,
        response=ProviderResponse(message={"content": "ok"}, usage={}, response_model_name="model"),
    )

    assert response.usage["total_tokens"] == 7
    assert response.usage["prompt_tokens"] == 1
    assert setup.session_model.context_tokens == 4


def test_finalize_response_without_usage_aggregate(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.session = SimpleNamespace(add=lambda *_args, **_kwargs: None, commit=lambda: None)
    service.chat_repo = SimpleNamespace()

    assistant_msg = SimpleNamespace(
        role=models.ChatRole.ASSISTANT,
        content="ok",
        tool_payload=None,
        tool_call_id=None,
    )

    monkeypatch.setattr(chat_service_module, "record_message", lambda *_args, **_kwargs: assistant_msg)
    monkeypatch.setattr(chat_service_module, "serialize_message", lambda *_args, **_kwargs: {"role": "assistant"})
    monkeypatch.setattr(
        chat_service_module,
        "convert_session",
        lambda *_args, **_kwargs: {
            "id": uuid4(),
            "user_id": uuid4(),
            "title": "Session",
            "mode": models.ChatMode.CHAT,
            "chat_model": "model",
            "context_tokens": 0,
            "tool_collection_ids": [],
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        },
    )
    monkeypatch.setattr(chat_service_module, "convert_messages", lambda *_args, **_kwargs: [])

    setup = _build_setup()
    run_state = RunState(provider="openrouter")

    response = service._finalize_response(
        setup=setup,
        run_state=run_state,
        response=ProviderResponse(message={"content": "ok"}, usage={"total_tokens": 2}, response_model_name="model"),
    )

    assert response.usage["total_tokens"] == 2
    assert setup.session_model.context_tokens == 2


def test_stream_iteration_captures_tokens_and_reasoning(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()

    def _fake_stream(*_args, **_kwargs):
        yield {"type": "token", "content": "Hello"}
        yield {"type": "reasoning", "segments": [{"type": "text", "content": "thinking"}]}
        return {"content": "Hello"}, {}, "router", None, "model"

    monkeypatch.setattr(chat_service_module, "stream_model_completion", _fake_stream)

    capture = StreamCapture()
    gen = service._stream_iteration(
        provider=SimpleNamespace(name="router"),
        setup=setup,
        capture=capture,
    )

    assert next(gen)["type"] == "token"
    assert next(gen)["type"] == "reasoning"

    with pytest.raises(StopIteration) as stop_exc:
        next(gen)

    assert capture.content_parts == ["Hello"]
    assert capture.reasoning_segments == [{"type": "text", "content": "thinking"}]
    assert stop_exc.value.value[2] == "router"


def test_stream_iteration_skips_invalid_event_shapes(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()

    def _fake_stream(*_args, **_kwargs):
        yield "skip"
        yield {"type": "tool_call", "id": "call-1"}
        yield {"type": "token", "content": 123}
        yield {"type": "reasoning", "segments": "nope"}
        return {"content": "ok"}, {}, "router", None, "model"

    monkeypatch.setattr(chat_service_module, "stream_model_completion", _fake_stream)

    capture = StreamCapture()
    gen = service._stream_iteration(
        provider=SimpleNamespace(name="router"),
        setup=setup,
        capture=capture,
    )

    assert next(gen) == "skip"
    assert next(gen)["type"] == "tool_call"
    assert next(gen)["type"] == "token"
    assert next(gen)["type"] == "reasoning"

    with pytest.raises(StopIteration):
        next(gen)

    assert capture.content_parts == []
    assert capture.reasoning_segments == []


def test_stream_message_updates_usage() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()
    provider = SimpleNamespace(name="router")
    usage_called: dict[str, Any] = {}

    service._ensure_provider = lambda *_args, **_kwargs: provider
    service._prepare_chat_setup = lambda **_kwargs: setup

    def _stream_iteration(*_args, **_kwargs):
        if False:
            yield {}
        return {"content": "done"}, {"prompt_tokens": 1}, "router", None, "model"

    def _no_tool_calls(*_args, **_kwargs):
        if False:
            yield {}
        return False

    service._stream_iteration = _stream_iteration
    service._stream_tool_calls_if_needed = _no_tool_calls
    service._finalize_response = lambda **_kwargs: SimpleNamespace(model_dump=lambda: {"ok": True})
    service._update_usage_aggregate = lambda *_args, **_kwargs: usage_called.setdefault("called", True)

    events = list(
        service.stream_message(
            user=SimpleNamespace(id=uuid4()),
            payload=ChatMessageCreate(content="hi"),
        )
    )

    assert events[0]["type"] == "final"
    assert usage_called["called"] is True


def test_stream_message_raises_after_max_iterations() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()
    provider = SimpleNamespace(name="router")
    service.MAX_TOOL_ITERATIONS = 1

    service._ensure_provider = lambda *_args, **_kwargs: provider
    service._prepare_chat_setup = lambda **_kwargs: setup

    def _stream_iteration(*_args, **_kwargs):
        if False:
            yield {}
        return {"content": "tool"}, {}, "router", None, "model"

    def _tool_calls(*_args, **_kwargs):
        if False:
            yield {}
        return True

    service._stream_iteration = _stream_iteration
    service._stream_tool_calls_if_needed = _tool_calls

    with pytest.raises(RuntimeError, match="tool iteration limit"):
        list(
            service.stream_message(
                user=SimpleNamespace(id=uuid4()),
                payload=ChatMessageCreate(content="hi"),
            )
        )


def test_send_message_handles_usage_and_tool_calls() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()
    provider = SimpleNamespace(name="router")

    parsed = ParsedChatResponse(
        message={"content": ["hello"]},
        usage={"prompt_tokens": 1},
        provider="router",
        response_model="model",
    )

    provider.chat = lambda *_args, **_kwargs: {}
    provider.parse_chat_response = lambda *_args, **_kwargs: parsed

    service._ensure_provider = lambda *_args, **_kwargs: provider
    service._prepare_chat_setup = lambda **_kwargs: setup

    calls = {"count": 0}
    captured: dict[str, Any] = {}

    def _resolve_tool_calls(**_kwargs):
        if calls["count"] == 0:
            calls["count"] += 1
            return ToolCallResolution(
                pending_tool_calls=[{"id": "call-1", "type": "function", "function": {"name": "tool", "arguments": "{}"}}],
                shared_tool_reasoning=None,
            )
        return ToolCallResolution(pending_tool_calls=[], shared_tool_reasoning=None)

    service._resolve_tool_calls = _resolve_tool_calls
    service._append_tool_call_assistant_message = lambda **kwargs: captured.update(
        assistant_content=kwargs["assistant_content"]
    )
    service._execute_tool_calls = lambda **_kwargs: None
    service._finalize_response = lambda **_kwargs: SimpleNamespace()
    service._update_usage_aggregate = lambda *_args, **_kwargs: captured.setdefault("usage", True)

    service.send_message(
        user=SimpleNamespace(id=uuid4()),
        payload=ChatMessageCreate(content="hi"),
    )

    assert captured["usage"] is True
    assert captured["assistant_content"] == json.dumps(["hello"])


def test_send_message_raises_after_max_iterations() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    setup = _build_setup()
    provider = SimpleNamespace(name="router")

    parsed = ParsedChatResponse(
        message={"content": "tool"},
        usage={},
        provider="router",
        response_model="model",
    )

    provider.chat = lambda *_args, **_kwargs: {}
    provider.parse_chat_response = lambda *_args, **_kwargs: parsed

    service._ensure_provider = lambda *_args, **_kwargs: provider
    service._prepare_chat_setup = lambda **_kwargs: setup
    service._resolve_tool_calls = lambda **_kwargs: ToolCallResolution(
        pending_tool_calls=[{"id": "call-1", "type": "function", "function": {"name": "tool", "arguments": "{}"}}],
        shared_tool_reasoning=None,
    )
    service._append_tool_call_assistant_message = lambda **_kwargs: None
    service._execute_tool_calls = lambda **_kwargs: None

    with pytest.raises(RuntimeError, match="tool iteration limit"):
        service.send_message(
            user=SimpleNamespace(id=uuid4()),
            payload=ChatMessageCreate(content="hi"),
        )
