from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.chat import service as service_module
from app.chat.service import ChatService
from app.chat.setup import ChatSetupBuilder
from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.schemas.models import ModelInfo
from tests.chat.conftest import (
    StubOpenRouter,
    StubRetrievalService,
    StubSettings,
    tool_model_info,
)


@pytest.fixture(name="stream", params=[False, True], ids=["send", "stream"])
def stream_param(request) -> bool:
    """Drive both the non-streaming and streaming entry points from one test."""
    return request.param


def _drive(service: ChatService, user: models.User, payload: ChatMessageCreate, *, stream: bool):
    """Invoke send_message or stream_message; streaming is drained to force the error."""
    if stream:
        return list(service.stream_message(user=user, payload=payload))
    return service.send_message(user=user, payload=payload)


def test_rejects_missing_edit_message(session: Session, chat_user, install_chat_flow, stream) -> None:
    install_chat_flow(openrouter=StubOpenRouter(tool_model_info("test-model"), {}), chat_model="test-model")
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())

    with pytest.raises(ValueError, match="Message not found for editing"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_empty_content(session: Session, chat_user, install_chat_flow, stream) -> None:
    install_chat_flow(openrouter=StubOpenRouter(tool_model_info("test-model"), {}), chat_model="test-model")
    service = ChatService(session)
    payload = ChatMessageCreate(content="   ")

    with pytest.raises(ValueError, match="Message content cannot be empty"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_unavailable_model(session: Session, chat_user, install_chat_flow, stream) -> None:
    install_chat_flow(openrouter=StubOpenRouter(None, {}), chat_model="test-model")
    chat_session = models.ChatSession(user_id=chat_user.id, title="S", chat_model="missing-model")
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", session_id=chat_session.id)

    with pytest.raises(ValueError, match="Selected model is not available"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_model_without_tool_support(
    session: Session, chat_user, make_collection, install_chat_flow, stream
) -> None:
    collection = make_collection(chat_user)
    model_info = ModelInfo(
        id="no-tools", name="No Tools", context_length=1024, supported_parameters=["temperature"]
    )
    install_chat_flow(openrouter=StubOpenRouter(model_info, {}), chat_model="no-tools")
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id])

    with pytest.raises(ValueError, match="does not support tool calls"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_when_no_chat_model_configured(
    session: Session, chat_user, monkeypatch, stub_pipeline_settings, stream
) -> None:
    monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings(default_chat_model=""))
    monkeypatch.setattr(
        service_module, "get_openrouter_client", lambda *_a, **_k: StubOpenRouter(tool_model_info(), {})
    )
    monkeypatch.setattr(service_module, "RetrievalService", StubRetrievalService)
    stub_pipeline_settings(chat_model=None)
    chat_session = models.ChatSession(user_id=chat_user.id, title="S", chat_model="")
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", session_id=chat_session.id)

    with pytest.raises(ValueError, match="No chat model is configured"):
        _drive(service, chat_user, payload, stream=stream)


def test_resolve_session_model_raises_when_edit_session_missing() -> None:
    """Defensive branch: an edit message resolves but its session does not.

    Unreachable through the real DB (get_message is user-scoped via its session),
    so it's exercised at the builder boundary with a stub repository.
    """
    edit_message = SimpleNamespace(session_id=uuid4())

    class _Repo:
        def get_message(self, *_args, **_kwargs):
            return edit_message

        def get_session(self, *_args, **_kwargs):
            return None

    builder = ChatSetupBuilder(
        session=SimpleNamespace(),
        chat_repo=_Repo(),
        collection_repo=SimpleNamespace(),
        settings=SimpleNamespace(default_chat_model="m"),
        reasoning_effort=None,
    )
    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())

    with pytest.raises(ValueError, match="Chat session not found for edit"):
        builder._resolve_session_model(
            user=SimpleNamespace(id=uuid4()),
            payload=payload,
            default_chat_model="m",
            primary_collection_id=None,
        )
