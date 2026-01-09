from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import chat as chat_routes
from app.db import models
from app.db.models import ChatRole
from app.db.repositories import ChatRepository, CollectionRepository, UserRepository
from app.schemas.chat import ChatCompletionResponse, ChatMessageCreate, ChatMessageRead, ChatSessionRead


class _DummyRequest:
    async def is_disconnected(self) -> bool:
        return False


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User, name: str) -> models.Collection:
    repo = CollectionRepository(session)
    collection = models.Collection(
        user_id=user.id,
        name=name,
        description="",
        extra_metadata={},
    )
    repo.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_chat_session(
    session: Session,
    user: models.User,
    *,
    collection: models.Collection | None = None,
) -> models.ChatSession:
    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id if collection else None,
        title="Session",
        mode=models.ChatMode.CHAT,
        chat_model="chat",
        context_tokens=0,
    )
    repo = ChatRepository(session)
    repo.add_session(chat_session)
    session.commit()
    session.refresh(chat_session)
    if collection:
        repo.replace_session_collections(session_id=chat_session.id, collection_ids=[collection.id])
        session.commit()
    return chat_session


def _add_message(
    session: Session,
    chat_session: models.ChatSession,
    role: ChatRole,
    content: str,
) -> models.ChatMessage:
    message = models.ChatMessage(
        session_id=chat_session.id,
        role=role,
        content=content,
        created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    repo = ChatRepository(session)
    repo.add_message(message)
    session.commit()
    session.refresh(message)
    return message


def test_chat_maps_value_error(monkeypatch, session: Session) -> None:
    user = _create_user(session)

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def send_message(self, **_kwargs):
            raise ValueError("bad request")

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.chat(ChatMessageCreate(content="hi"), current_user=user, session=session)

    assert excinfo.value.status_code == 400


def test_chat_returns_response(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, "Collection")
    chat_session = _create_chat_session(session, user, collection=collection)
    message = _add_message(session, chat_session, ChatRole.USER, "hi")

    response = ChatCompletionResponse(
        session=ChatSessionRead.from_model(chat_session, tool_collection_ids=[collection.id]),
        messages=[ChatMessageRead.from_model(message)],
        tool_traces=[],
        usage={"prompt_tokens": 1},
        provider="openrouter",
        context_window=1024,
        context_consumed=0,
    )

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def send_message(self, **_kwargs):
            return response

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)

    result = chat_routes.chat(ChatMessageCreate(content="hi"), current_user=user, session=session)

    assert result.provider == "openrouter"


def test_list_sessions_and_history_paths(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, "Collection")
    chat_session = _create_chat_session(session, user, collection=collection)
    _add_message(session, chat_session, ChatRole.USER, "hi")

    sessions = chat_routes.list_sessions(
        current_user=user,
        session=session,
        collection_ids=None,
        include_unassigned=False,
    )
    history = chat_routes.get_chat_history(chat_session.id, current_user=user, session=session)

    assert sessions[0].id == chat_session.id
    assert sessions[0].tool_collection_ids == [collection.id]
    assert history[0].content == "hi"


def test_list_sessions_filters_by_collection(session: Session) -> None:
    user = _create_user(session)
    collection_a = _create_collection(session, user, "Alpha")
    collection_b = _create_collection(session, user, "Beta")
    session_a = _create_chat_session(session, user, collection=collection_a)
    session_b = _create_chat_session(session, user, collection=collection_b)
    unassigned = _create_chat_session(session, user, collection=None)

    filtered = chat_routes.list_sessions(
        current_user=user,
        session=session,
        collection_ids=[collection_a.id],
        include_unassigned=False,
    )
    filtered_ids = {entry.id for entry in filtered}
    assert session_a.id in filtered_ids
    assert session_b.id not in filtered_ids
    assert unassigned.id not in filtered_ids


def test_list_sessions_filters_include_unassigned(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, "Alpha")
    session_a = _create_chat_session(session, user, collection=collection)
    unassigned = _create_chat_session(session, user, collection=None)

    filtered = chat_routes.list_sessions(
        current_user=user,
        session=session,
        collection_ids=[collection.id],
        include_unassigned=True,
    )
    filtered_ids = {entry.id for entry in filtered}
    assert session_a.id in filtered_ids
    assert unassigned.id in filtered_ids


def test_get_chat_history_missing_records(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.get_chat_history(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_delete_chat_session_paths(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, "Collection")
    chat_session = _create_chat_session(session, user, collection=collection)

    response = chat_routes.delete_chat_session(chat_session.id, current_user=user, session=session)
    assert response.status_code == 204

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.delete_chat_session(chat_session.id, current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_stream_chat_yields_events(monkeypatch) -> None:
    user = SimpleNamespace(
        id=uuid4(),
        openrouter_api_key="openrouter-key",
    )

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def stream_message(self, **_kwargs):
            yield {"type": "token", "content": "hi"}
            yield {"type": "final", "payload": {"ok": True}}

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    response = chat_routes.stream_chat(
        ChatMessageCreate(content="hi"),
        _DummyRequest(),
        token="token",
    )

    async def _collect():
        return [chunk async for chunk in response.body_iterator]

    body = asyncio.run(_collect())

    first = body[0].decode() if isinstance(body[0], (bytes, bytearray)) else body[0]
    last = body[-1].decode() if isinstance(body[-1], (bytes, bytearray)) else body[-1]
    assert "data: {" in first
    assert last == "data: [DONE]\n\n"


def test_stream_chat_handles_errors(monkeypatch) -> None:
    user = SimpleNamespace(
        id=uuid4(),
        openrouter_api_key="openrouter-key",
    )

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def stream_message(self, **_kwargs):
            yield {"type": "token", "content": "hi"}
            raise RuntimeError("boom")

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    response = chat_routes.stream_chat(
        ChatMessageCreate(content="hi"),
        _DummyRequest(),
        token="token",
    )

    async def _collect():
        return [chunk async for chunk in response.body_iterator]

    body = asyncio.run(_collect())

    materialized = [chunk.decode() if isinstance(chunk, (bytes, bytearray)) else chunk for chunk in body]
    assert any("error" in chunk for chunk in materialized)


def test_stream_chat_closes_on_disconnect(monkeypatch) -> None:
    user = SimpleNamespace(
        id=uuid4(),
        openrouter_api_key="openrouter-key",
    )

    class _DisconnectingRequest:
        def __init__(self) -> None:
            self._called = False

        async def is_disconnected(self) -> bool:
            if not self._called:
                self._called = True
                return True
            return True

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def stream_message(self, **_kwargs):
            yield {"type": "token", "content": "hi"}

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    response = chat_routes.stream_chat(
        ChatMessageCreate(content="hi"),
        _DisconnectingRequest(),
        token="token",
    )

    async def _collect():
        return [chunk async for chunk in response.body_iterator]

    body = asyncio.run(_collect())
    materialized = [chunk.decode() if isinstance(chunk, (bytes, bytearray)) else chunk for chunk in body]
    assert any("data: {" in chunk for chunk in materialized)
