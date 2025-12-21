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
from app.db.models import ChatRole, ChunkStrategy
from app.db.repositories import ChatRepository, CollectionRepository, UserRepository
from app.schemas.chat import ChatCompletionResponse, ChatMessageCreate, ChatMessageRead, ChatSessionRead


class _DummyRequest:
    async def is_disconnected(self) -> bool:
        return False


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(email="user@example.com", full_name="User", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    repo = CollectionRepository(session)
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        embedding_model="embed",
        chat_model="chat",
        context_window=1024,
        chunk_size=128,
        chunk_overlap=8,
        chunk_strategy=ChunkStrategy.TOKEN,
        pinecone_index="idx",
        pinecone_namespace=f"ns-{uuid4().hex[:6]}",
        metadata={"embedding_dimension": 128},
    )
    repo.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_chat_session(session: Session, user: models.User, collection: models.Collection) -> models.ChatSession:
    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id,
        title="Session",
        mode=models.ChatMode.CHAT,
        chat_model=collection.chat_model,
        context_tokens=0,
    )
    repo = ChatRepository(session)
    repo.add_session(chat_session)
    session.commit()
    session.refresh(chat_session)
    return chat_session


def _add_message(session: Session, chat_session: models.ChatSession, role: ChatRole, content: str) -> models.ChatMessage:
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


def test_chat_with_collection_raises_when_missing(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.chat_with_collection(uuid4(), ChatMessageCreate(content="hi"), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_chat_with_collection_maps_value_error(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def send_message(self, **_kwargs):
            raise ValueError("bad request")

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.chat_with_collection(
            collection.id,
            ChatMessageCreate(content="hi"),
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 400


def test_chat_with_collection_returns_response(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_chat_session(session, user, collection)
    message = _add_message(session, chat_session, ChatRole.USER, "hi")

    response = ChatCompletionResponse(
        session=ChatSessionRead.from_model(chat_session),
        messages=[ChatMessageRead.from_model(message)],
        tool_traces=[],
        usage={"prompt_tokens": 1},
        provider="openrouter",
        context_window=collection.context_window,
        context_consumed=0,
    )

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def send_message(self, **_kwargs):
            return response

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)

    result = chat_routes.chat_with_collection(
        collection.id,
        ChatMessageCreate(content="hi"),
        current_user=user,
        session=session,
    )

    assert result.provider == "openrouter"


def test_list_sessions_and_history_paths(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_chat_session(session, user, collection)
    _add_message(session, chat_session, ChatRole.USER, "hi")

    sessions = chat_routes.list_sessions(collection.id, current_user=user, session=session)
    history = chat_routes.get_chat_history(chat_session.id, current_user=user, session=session)

    assert sessions[0].id == chat_session.id
    assert history[0].content == "hi"


def test_list_sessions_and_history_missing_records(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.list_sessions(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.get_chat_history(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_delete_chat_session_paths(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_chat_session(session, user, collection)

    response = chat_routes.delete_chat_session(chat_session.id, current_user=user, session=session)
    assert response.status_code == 204

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.delete_chat_session(chat_session.id, current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_stream_chat_with_collection_yields_events(monkeypatch) -> None:
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def stream_message(self, **_kwargs):
            yield {"type": "token", "content": "hi"}
            yield {"type": "final", "payload": {"ok": True}}

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)
    monkeypatch.setattr(chat_routes, "get_collection_or_404", lambda **_kwargs: collection)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    response = chat_routes.stream_chat_with_collection(
        collection.id,
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


def test_stream_chat_with_collection_handles_errors(monkeypatch) -> None:
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

        def stream_message(self, **_kwargs):
            yield {"type": "token", "content": "hi"}
            raise RuntimeError("boom")

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)
    monkeypatch.setattr(chat_routes, "get_collection_or_404", lambda **_kwargs: collection)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    response = chat_routes.stream_chat_with_collection(
        collection.id,
        ChatMessageCreate(content="hi"),
        _DummyRequest(),
        token="token",
    )

    async def _collect():
        return [chunk async for chunk in response.body_iterator]

    body = asyncio.run(_collect())

    materialized = [chunk.decode() if isinstance(chunk, (bytes, bytearray)) else chunk for chunk in body]
    assert any("error" in chunk for chunk in materialized)


def test_stream_chat_with_collection_rejects_missing_collection(monkeypatch) -> None:
    user = SimpleNamespace(id=uuid4())

    class _StubChatService:
        def __init__(self, _session: Session) -> None:
            return None

    monkeypatch.setattr(chat_routes, "ChatService", _StubChatService)
    def _missing_collection(**_kwargs):
        raise HTTPException(status_code=404, detail="Collection not found")

    monkeypatch.setattr(chat_routes, "get_collection_or_404", _missing_collection)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    with pytest.raises(HTTPException) as excinfo:
        chat_routes.stream_chat_with_collection(
            uuid4(),
            ChatMessageCreate(content="hi"),
            _DummyRequest(),
            token="token",
        )

    assert excinfo.value.status_code == 404


def test_stream_chat_with_collection_closes_on_disconnect(monkeypatch) -> None:
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

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
    monkeypatch.setattr(chat_routes, "get_collection_or_404", lambda **_kwargs: collection)
    monkeypatch.setattr(chat_routes, "get_current_user", lambda token, session: user)

    response = chat_routes.stream_chat_with_collection(
        collection.id,
        ChatMessageCreate(content="hi"),
        _DisconnectingRequest(),
        token="token",
    )

    async def _collect():
        return [chunk async for chunk in response.body_iterator]

    body = asyncio.run(_collect())
    materialized = [chunk.decode() if isinstance(chunk, (bytes, bytearray)) else chunk for chunk in body]
    assert any("data: {" in chunk for chunk in materialized)
