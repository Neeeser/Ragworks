"""Behavior of the per-user model shortlist (pins and recents)."""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.enums import ProviderKind
from app.schemas.model_shortlist import ModelShortlistIdentity
from app.services.errors import NotFoundError
from app.services.model_shortlist import RECENTS_LIMIT, ModelShortlistService
from tests.utils.providers import add_connection


def _user(session: Session, email: str = "shortlist@example.com") -> models.User:
    user = models.User(email=email, hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _identity(
    connection: models.ProviderConnection,
    model_id: str,
    kind: ProviderKind = ProviderKind.CHAT,
) -> ModelShortlistIdentity:
    return ModelShortlistIdentity(
        kind=kind, connection_id=connection.id, model_id=model_id
    )


def test_pin_is_idempotent(session: Session) -> None:
    user = _user(session)
    connection = add_connection(session, user, "openrouter", {"api_key": "k"})
    service = ModelShortlistService(session)

    service.pin(user, _identity(connection, "anthropic/claude-sonnet-5"))
    service.pin(user, _identity(connection, "anthropic/claude-sonnet-5"))

    shortlist = service.list_shortlist(user, ProviderKind.CHAT)
    assert [entry.model_id for entry in shortlist.pinned] == [
        "anthropic/claude-sonnet-5"
    ]


def test_unpin_removes_the_pin_and_is_safe_to_repeat(session: Session) -> None:
    user = _user(session)
    connection = add_connection(session, user, "openrouter", {"api_key": "k"})
    service = ModelShortlistService(session)
    identity = _identity(connection, "openai/gpt-5")
    service.pin(user, identity)

    service.unpin(user, identity)
    service.unpin(user, identity)

    assert service.list_shortlist(user, ProviderKind.CHAT).pinned == []


def test_shortlist_is_scoped_per_kind(session: Session) -> None:
    user = _user(session)
    connection = add_connection(session, user, "openrouter", {"api_key": "k"})
    service = ModelShortlistService(session)

    service.pin(user, _identity(connection, "chat-model", ProviderKind.CHAT))
    service.pin(
        user, _identity(connection, "embed-model", ProviderKind.EMBEDDING)
    )

    chat = service.list_shortlist(user, ProviderKind.CHAT)
    embedding = service.list_shortlist(user, ProviderKind.EMBEDDING)
    assert [entry.model_id for entry in chat.pinned] == ["chat-model"]
    assert [entry.model_id for entry in embedding.pinned] == ["embed-model"]


def test_record_use_dedupes_and_bumps_last_used(session: Session) -> None:
    user = _user(session)
    connection = add_connection(session, user, "openrouter", {"api_key": "k"})
    service = ModelShortlistService(session)
    identity = _identity(connection, "openai/gpt-5")

    first = service.record_use(user, identity)
    second = service.record_use(user, identity)

    recents = service.list_shortlist(user, ProviderKind.CHAT).recent
    assert [entry.model_id for entry in recents] == ["openai/gpt-5"]
    assert first.last_used_at is not None
    assert second.last_used_at is not None
    assert second.last_used_at >= first.last_used_at


def test_record_use_prunes_oldest_past_the_cap(session: Session) -> None:
    user = _user(session)
    connection = add_connection(session, user, "openrouter", {"api_key": "k"})
    service = ModelShortlistService(session)
    for index in range(RECENTS_LIMIT + 3):
        service.record_use(user, _identity(connection, f"model-{index}"))

    recents = service.list_shortlist(user, ProviderKind.CHAT).recent
    assert len(recents) == RECENTS_LIMIT
    assert "model-0" not in {entry.model_id for entry in recents}
    assert f"model-{RECENTS_LIMIT + 2}" in {entry.model_id for entry in recents}


def test_pinning_another_users_connection_is_not_found(session: Session) -> None:
    owner = _user(session, "owner@example.com")
    intruder = _user(session, "intruder@example.com")
    connection = add_connection(session, owner, "openrouter", {"api_key": "k"})

    with pytest.raises(NotFoundError):
        ModelShortlistService(session).pin(intruder, _identity(connection, "gpt-5"))


def test_entries_persist_and_read_back_through_a_fresh_session(
    session: Session,
) -> None:
    user = _user(session)
    connection = add_connection(session, user, "openrouter", {"api_key": "k"})
    ModelShortlistService(session).pin(user, _identity(connection, "openai/gpt-5"))

    with Session(session.get_bind()) as fresh:
        rows = ModelShortlistService(fresh).list_shortlist(user, ProviderKind.CHAT)
        assert [entry.model_id for entry in rows.pinned] == ["openai/gpt-5"]
