from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.chat.service import ChatService
from app.db import models
from app.db.models import ChatRole
from app.db.repositories import ChatRepository, CollectionRepository, UserRepository
from app.services.errors import InvalidInputError


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(
        email="brancher@example.com",
        full_name="Branch User",
        hashed_password="hashed",
    )
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    repo = CollectionRepository(session)
    collection = models.Collection(
        user_id=user.id,
        name="Branch Collection",
        description="",
        extra_metadata={},
    )
    repo.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_session(session: Session, user: models.User, collection: models.Collection) -> models.ChatSession:
    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id,
        title="Session",
        mode=models.ChatMode.CHAT,
        chat_model="chat",
        context_tokens=0,
    )
    repo = ChatRepository(session)
    repo.add_session(chat_session)
    session.commit()
    session.refresh(chat_session)
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
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
        updated_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    repo = ChatRepository(session)
    repo.add_message(message)
    session.commit()
    session.refresh(message)
    return message


def test_branch_session_copies_history(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    user_message = _add_message(session, chat_session, ChatRole.USER, "hello")
    assistant_message = _add_message(session, chat_session, ChatRole.ASSISTANT, "hi there")

    service = ChatService(session)
    response = service.branch_session(
        user=user,
        session_id=chat_session.id,
        message_id=assistant_message.id,
        title=None,
    )

    assert response.session.branched_from_session_id == chat_session.id
    assert response.session.branched_from_message_id == assistant_message.id
    assert response.session.title.startswith("Branch of")
    assert response.session.tool_collection_ids == [collection.id]
    assert len(response.messages) == 2
    assert response.messages[0].source_message_id == user_message.id
    assert response.messages[1].source_message_id == assistant_message.id


def test_branch_session_rejects_unknown_session(session: Session) -> None:
    user = _create_user(session)
    service = ChatService(session)

    with pytest.raises(InvalidInputError, match="Chat session not found"):
        service.branch_session(
            user=user,
            session_id=uuid4(),
            message_id=uuid4(),
            title=None,
        )


def test_branch_session_rejects_unknown_message(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    service = ChatService(session)

    with pytest.raises(InvalidInputError, match="Message not found for branching"):
        service.branch_session(
            user=user,
            session_id=chat_session.id,
            message_id=uuid4(),
            title=None,
        )


def test_branch_session_rejects_message_from_other_session(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    other_session = _create_session(session, user, collection)
    other_message = _add_message(session, other_session, ChatRole.USER, "elsewhere")
    service = ChatService(session)

    with pytest.raises(InvalidInputError, match="does not belong to this session"):
        service.branch_session(
            user=user,
            session_id=chat_session.id,
            message_id=other_message.id,
            title=None,
        )
