from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.models import ChunkStrategy
from app.db.repositories import ChatRepository
from app.services.chat import ChatService


def _create_user(session: Session) -> models.User:
    user = models.User(email="edit@example.com", full_name="Editor", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Edit Collection",
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
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_chat_session(
    session: Session,
    user: models.User,
    collection: models.Collection,
) -> models.ChatSession:
    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id,
        title="Session",
        mode=models.ChatMode.CHAT,
        chat_model=collection.chat_model,
        context_tokens=0,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    return chat_session


def _add_message(
    session: Session,
    chat_session: models.ChatSession,
    *,
    role: models.ChatRole,
    content: str,
    created_at: datetime,
) -> models.ChatMessage:
    message = models.ChatMessage(
        session_id=chat_session.id,
        role=role,
        content=content,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def _service(session: Session) -> ChatService:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.session = session
    service.chat_repo = ChatRepository(session)
    return service


def test_apply_edit_updates_user_message_and_prunes_following(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_chat_session(session, user, collection)
    base_time = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    user_message = _add_message(
        session,
        chat_session,
        role=models.ChatRole.USER,
        content="Original",
        created_at=base_time,
    )
    _add_message(
        session,
        chat_session,
        role=models.ChatRole.ASSISTANT,
        content="Response",
        created_at=base_time + timedelta(minutes=1),
    )

    service = _service(session)

    service._apply_edit(
        session_model=chat_session,
        target_message=user_message,
        new_content=" Updated ",
    )

    messages = list(service.chat_repo.list_messages(chat_session.id, limit=0))
    assert len(messages) == 1
    assert messages[0].content == "Updated"


def test_apply_edit_prunes_non_user_messages_after_anchor(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_chat_session(session, user, collection)
    base_time = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    _add_message(
        session,
        chat_session,
        role=models.ChatRole.USER,
        content="Question",
        created_at=base_time,
    )
    assistant_message = _add_message(
        session,
        chat_session,
        role=models.ChatRole.ASSISTANT,
        content="Answer",
        created_at=base_time + timedelta(minutes=1),
    )
    _add_message(
        session,
        chat_session,
        role=models.ChatRole.TOOL,
        content="Tool payload",
        created_at=base_time + timedelta(minutes=2),
    )
    _add_message(
        session,
        chat_session,
        role=models.ChatRole.ASSISTANT,
        content="Follow up",
        created_at=base_time + timedelta(minutes=3),
    )

    service = _service(session)

    service._apply_edit(
        session_model=chat_session,
        target_message=assistant_message,
        new_content="ignored",
    )

    messages = list(service.chat_repo.list_messages(chat_session.id, limit=0))
    assert len(messages) == 1
    assert messages[0].role == models.ChatRole.USER


def test_apply_edit_rejects_message_from_other_session(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_chat_session(session, user, collection)
    other_session = _create_chat_session(session, user, collection)
    other_message = _add_message(
        session,
        other_session,
        role=models.ChatRole.USER,
        content="Other session",
        created_at=datetime.now(timezone.utc),
    )

    service = _service(session)

    with pytest.raises(ValueError, match="does not belong to this session"):
        service._apply_edit(
            session_model=chat_session,
            target_message=other_message,
            new_content="update",
        )
