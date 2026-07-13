from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from openai import RateLimitError
from sqlmodel import Session

from app.chat.service import ChatService
from app.chat.setup import ChatSetupBuilder
from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.schemas.enums import IndexBackend
from app.schemas.models import ModelInfo
from app.services.errors import ExternalServiceError, InvalidInputError
from tests.chat.conftest import (
    StubOpenRouter,
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


class _RateLimitedOpenRouter:
    """Stand-in for `OpenRouterClient` whose `chat()` call hits an OpenRouter 429."""

    def __init__(self, model_info: ModelInfo) -> None:
        self._model_info = model_info

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._model_info

    def chat(self, **_kwargs):
        response = httpx.Response(
            status_code=429, request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat")
        )
        raise RateLimitError("Rate limit exceeded", response=response, body=None)


def test_send_message_maps_openrouter_rate_limit_to_external_service_error(
    session: Session, chat_user, install_chat_flow
) -> None:
    """A 429 from OpenRouter mid-request must surface as a 502-mapped
    `ExternalServiceError`, not the raw `openai.RateLimitError` (which the
    route has no handler for and would otherwise 500 on)."""
    install_chat_flow(
        openrouter=_RateLimitedOpenRouter(tool_model_info("test-model")), chat_model="test-model"
    )
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi")

    with pytest.raises(ExternalServiceError, match="Rate limit exceeded"):
        service.send_message(user=chat_user, payload=payload)


def test_rejects_missing_edit_message(session: Session, chat_user, install_chat_flow, stream) -> None:
    install_chat_flow(openrouter=StubOpenRouter(tool_model_info("test-model"), {}), chat_model="test-model")
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())

    with pytest.raises(InvalidInputError, match="Message not found for editing"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_empty_content(session: Session, chat_user, install_chat_flow, stream) -> None:
    install_chat_flow(openrouter=StubOpenRouter(tool_model_info("test-model"), {}), chat_model="test-model")
    service = ChatService(session)
    payload = ChatMessageCreate(content="   ")

    with pytest.raises(InvalidInputError, match="Message content cannot be empty"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_unavailable_model(session: Session, chat_user, install_chat_flow, stream) -> None:
    install_chat_flow(openrouter=StubOpenRouter(None, {}), chat_model="test-model")
    chat_session = models.ChatSession(
        user_id=chat_user.id,
        title="S",
        chat_model="missing-model",
        provider_connection_id=chat_user.last_used_chat_connection_id,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", session_id=chat_session.id)

    with pytest.raises(InvalidInputError, match="Selected model is not available"):
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

    with pytest.raises(InvalidInputError, match="does not support tool calls"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_when_no_chat_model_configured(
    session: Session, chat_user, install_chat_flow, stream
) -> None:
    install_chat_flow(openrouter=StubOpenRouter(tool_model_info(), {}), chat_model=None)
    chat_session = models.ChatSession(
        user_id=chat_user.id,
        title="S",
        chat_model="",
        provider_connection_id=chat_user.last_used_chat_connection_id,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", session_id=chat_session.id)

    with pytest.raises(InvalidInputError, match="Pick a chat model"):
        _drive(service, chat_user, payload, stream=stream)


def test_rejects_when_session_has_no_provider_connection(
    session: Session, chat_user, install_chat_flow, stream
) -> None:
    """A session whose provider connection was deleted (SET NULL) gets a clear
    'pick a provider' error rather than an AttributeError or a silent default."""
    install_chat_flow(openrouter=StubOpenRouter(tool_model_info(), {}), chat_model="test-model")
    chat_session = models.ChatSession(
        user_id=chat_user.id,
        title="S",
        chat_model="test-model",
        provider_connection_id=None,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", session_id=chat_session.id)

    with pytest.raises(InvalidInputError, match="Pick a chat provider"):
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
        reasoning_effort=None,
    )
    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())

    with pytest.raises(InvalidInputError, match="Chat session not found for edit"):
        builder._resolve_session_model(
            user=SimpleNamespace(id=uuid4()),
            payload=payload,
            primary_collection_id=None,
        )


def _keyless_user(session: Session) -> models.User:
    """A user with an OpenRouter connection but no Pinecone connection."""
    user = models.User(
        email="keyless@example.com",
        full_name="Keyless",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    connection = models.ProviderConnection(
        user_id=user.id,
        provider_type="openrouter",
        label="OpenRouter",
        config={"api_key": "openrouter-key"},
    )
    session.add(connection)
    session.commit()
    user.last_used_chat_connection_id = connection.id
    user.last_used_chat_model = "test-model"
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_pinecone_backed_tools_require_pinecone_key(
    session: Session, make_collection, install_chat_flow, stream
) -> None:
    user = _keyless_user(session)
    collection = make_collection(user)
    install_chat_flow(
        openrouter=StubOpenRouter(tool_model_info(), {}),
        chat_model="test-model",
        backend=IndexBackend.PINECONE,
    )
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id])

    with pytest.raises(InvalidInputError, match="No Pinecone connection is configured"):
        _drive(service, user, payload, stream=stream)


def test_pgvector_backed_tools_need_no_pinecone_key(
    session: Session, make_collection, install_chat_flow
) -> None:
    """A user with no Pinecone key can chat with tools over a pgvector-backed
    collection -- the key check is per-backend, not global."""
    user = _keyless_user(session)
    collection = make_collection(user)
    response = {
        "id": "resp-1",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [
            {"index": 0, "message": {"content": "Answer"}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }
    install_chat_flow(
        openrouter=StubOpenRouter(tool_model_info(), response),
        chat_model="test-model",
        backend=IndexBackend.PGVECTOR,
    )
    service = ChatService(session)
    payload = ChatMessageCreate(content="hi", tool_collection_ids=[collection.id])

    result = service.send_message(user=user, payload=payload)

    assert result.messages[-1].content == "Answer"
