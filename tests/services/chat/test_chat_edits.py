from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import ChatRepository
from app.chat.persistence.sessions import apply_edit


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
        extra_metadata={},
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
        chat_model="chat",
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

    apply_edit(
        session=session,
        chat_repo=ChatRepository(session),
        session_model=chat_session,
        target_message=user_message,
        new_content=" Updated ",
    )

    messages = list(ChatRepository(session).list_messages(chat_session.id, limit=0))
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

    apply_edit(
        session=session,
        chat_repo=ChatRepository(session),
        session_model=chat_session,
        target_message=assistant_message,
        new_content="ignored",
    )

    messages = list(ChatRepository(session).list_messages(chat_session.id, limit=0))
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

    with pytest.raises(ValueError, match="does not belong to this session"):
        apply_edit(
            session=session,
            chat_repo=ChatRepository(session),
            session_model=chat_session,
            target_message=other_message,
            new_content="update",
        )


class _StubChatRepo:
    def __init__(self, last_user=None) -> None:
        self.last_user = last_user
        self.deleted_since = None
        self.deleted_after = None
        self.include_anchor = None

    def get_last_user_message_before(self, *_args, **_kwargs):
        return self.last_user

    def delete_tool_messages_since(self, *, session_id, since) -> None:
        self.deleted_since = (session_id, since)

    def delete_messages_after(self, *, session_id, created_at, include_anchor) -> None:
        self.deleted_after = (session_id, created_at)
        self.include_anchor = include_anchor


class _StubSession:
    def __init__(self, anchor_message=None) -> None:
        self.anchor_message = anchor_message
        self.added = []
        self.flushes = 0

    def add(self, obj) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushes += 1

    def exec(self, _statement):
        return SimpleNamespace(first=lambda: self.anchor_message)


def test_apply_edit_rejects_empty_user_edit() -> None:
    session_model = SimpleNamespace(id="session-1", updated_at=None)
    target_message = SimpleNamespace(
        session_id="session-1",
        role=models.ChatRole.USER,
        created_at=datetime.now(timezone.utc),
        updated_at=None,
        content="Original",
    )
    chat_repo = SimpleNamespace(delete_messages_after=lambda **_kwargs: None)
    session = SimpleNamespace(add=lambda *_args, **_kwargs: None, flush=lambda: None)

    with pytest.raises(ValueError, match="Edited message cannot be empty"):
        apply_edit(
            session=session,
            chat_repo=chat_repo,
            session_model=session_model,
            target_message=target_message,
            new_content="  ",
        )


def test_apply_edit_non_user_without_last_user_uses_target_anchor() -> None:
    created_at = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    session_model = SimpleNamespace(id="session-2", updated_at=None)
    target_message = SimpleNamespace(
        session_id="session-2",
        role=models.ChatRole.ASSISTANT,
        created_at=created_at,
    )
    chat_repo = _StubChatRepo(last_user=None)
    session = _StubSession(anchor_message=None)

    apply_edit(
        session=session,
        chat_repo=chat_repo,
        session_model=session_model,
        target_message=target_message,
        new_content="ignored",
    )

    assert chat_repo.deleted_since == ("session-2", created_at)
    assert chat_repo.deleted_after == ("session-2", created_at)
    assert chat_repo.include_anchor is True
