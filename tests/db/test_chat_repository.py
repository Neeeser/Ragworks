from __future__ import annotations

from datetime import UTC, datetime

from sqlmodel import Session

from app.db import models
from app.db.models import ChatRole
from app.db.repositories import ChatRepository, CollectionRepository, UserRepository


def _create_user(session: Session, email: str) -> models.User:
    repo = UserRepository(session)
    user = models.User(email=email, full_name="User", hashed_password="hashed")
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
    *,
    role: ChatRole,
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
    repo = ChatRepository(session)
    repo.add_message(message)
    session.commit()
    session.refresh(message)
    return message


def test_chat_repository_filters_sessions_by_user(session: Session) -> None:
    user_a = _create_user(session, "a@example.com")
    user_b = _create_user(session, "b@example.com")
    collection_a = _create_collection(session, user_a)
    collection_b = _create_collection(session, user_b)
    session_a = _create_session(session, user_a, collection_a)
    session_b = _create_session(session, user_b, collection_b)

    repo = ChatRepository(session)

    assert repo.get_session(session_a.id, user_id=user_a.id)
    assert repo.get_session(session_b.id, user_id=user_a.id) is None
    assert (
        len(
            list(
                repo.list_sessions(
                    collection_ids=[collection_a.id],
                    user_id=user_a.id,
                )
            )
        )
        == 1
    )


def test_chat_repository_filters_messages_by_user(session: Session) -> None:
    user_a = _create_user(session, "a@example.com")
    user_b = _create_user(session, "b@example.com")
    collection_a = _create_collection(session, user_a)
    collection_b = _create_collection(session, user_b)
    session_a = _create_session(session, user_a, collection_a)
    _create_session(session, user_b, collection_b)
    message = _add_message(
        session,
        session_a,
        role=ChatRole.USER,
        content="hello",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )

    repo = ChatRepository(session)

    assert repo.get_message(message.id, user_id=user_b.id) is None
    assert repo.get_message(message.id, user_id=user_a.id)


def test_chat_repository_deletes_messages_after_anchor(session: Session) -> None:
    user = _create_user(session, "a@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    anchor_time = datetime(2024, 1, 1, 12, 0, tzinfo=UTC)
    anchor = _add_message(session, chat_session, role=ChatRole.USER, content="a", created_at=anchor_time)
    _add_message(session, chat_session, role=ChatRole.USER, content="b", created_at=anchor_time.replace(minute=1))

    repo = ChatRepository(session)
    repo.delete_messages_after(chat_session.id, anchor.created_at, include_anchor=False)

    remaining = list(repo.list_messages(chat_session.id))
    assert len(remaining) == 1
    assert remaining[0].content == "a"

    repo.delete_messages_after(chat_session.id, anchor.created_at, include_anchor=True)
    assert list(repo.list_messages(chat_session.id)) == []


def test_chat_repository_tool_deletion_and_last_user_message(session: Session) -> None:
    user = _create_user(session, "a@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    t0 = datetime(2024, 1, 1, 10, 0, tzinfo=UTC)
    _add_message(session, chat_session, role=ChatRole.USER, content="first", created_at=t0)
    _add_message(session, chat_session, role=ChatRole.TOOL, content="tool", created_at=t0.replace(minute=1))
    _add_message(session, chat_session, role=ChatRole.USER, content="second", created_at=t0.replace(minute=2))

    repo = ChatRepository(session)
    last_user = repo.get_last_user_message_before(chat_session.id, t0.replace(minute=2))
    assert last_user
    assert last_user.content == "second"

    repo.delete_tool_messages_since(chat_session.id, t0.replace(minute=1))
    remaining_roles = [msg.role for msg in repo.list_messages(chat_session.id, limit=0)]
    assert ChatRole.TOOL not in remaining_roles


def test_chat_repository_list_messages_truncates_to_positive_limit(session: Session) -> None:
    """A positive `limit` must actually cap the returned rows (oldest-first),
    not just get passed through unused -- `limit=0`/`None` (tested elsewhere)
    exercise the falsy "return everything" branch, but nothing pinned the
    truncating branch itself."""
    user = _create_user(session, "a@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    t0 = datetime(2024, 1, 1, 10, 0, tzinfo=UTC)
    for index in range(5):
        _add_message(
            session,
            chat_session,
            role=ChatRole.USER,
            content=f"message-{index}",
            created_at=t0.replace(minute=index),
        )

    repo = ChatRepository(session)
    limited = repo.list_messages(chat_session.id, limit=2)

    assert len(limited) == 2
    assert [message.content for message in limited] == ["message-0", "message-1"]


def test_chat_repository_delete_session_removes_messages(session: Session) -> None:
    user = _create_user(session, "a@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    _add_message(session, chat_session, role=ChatRole.USER, content="hello", created_at=datetime.now(UTC))

    repo = ChatRepository(session)
    repo.delete_session(chat_session)
    session.commit()

    assert repo.get_session(chat_session.id) is None
    assert list(repo.list_messages(chat_session.id)) == []
    assert repo.list_session_collection_ids(chat_session.id) == []
