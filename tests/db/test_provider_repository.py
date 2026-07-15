"""Behavior tests for ProviderConnectionRepository."""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.db.repositories import ProviderConnectionRepository, UserRepository
from app.schemas.enums import ProviderType


def _create_user(session: Session, email: str) -> models.User:
    repo = UserRepository(session)
    user = models.User(email=email, full_name="Example", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_connections_are_user_scoped(session: Session) -> None:
    owner = _create_user(session, "owner@example.com")
    other = _create_user(session, "other@example.com")
    repo = ProviderConnectionRepository(session)
    created = repo.create(
        user_id=owner.id,
        provider_type=ProviderType.OLLAMA.value,
        label="Homelab",
        config={"base_url": "http://192.168.1.225:11434"},
    )
    session.commit()

    assert repo.get_owned(created.id, owner.id) is not None
    assert repo.get_owned(created.id, other.id) is None
    assert [c.id for c in repo.list_for_user(owner.id)] == [created.id]
    assert repo.list_for_user(other.id) == []
    assert repo.get_owned(uuid4(), owner.id) is None


def test_list_for_user_of_type_filters_and_orders(session: Session) -> None:
    user = _create_user(session, "multi@example.com")
    repo = ProviderConnectionRepository(session)
    first = repo.create(
        user_id=user.id,
        provider_type=ProviderType.OLLAMA.value,
        label="Desktop",
        config={"base_url": "http://10.0.0.5:11434"},
    )
    second = repo.create(
        user_id=user.id,
        provider_type=ProviderType.OLLAMA.value,
        label="Homelab",
        config={"base_url": "http://10.0.0.6:11434"},
    )
    repo.create(
        user_id=user.id,
        provider_type=ProviderType.OPENROUTER.value,
        label="OpenRouter",
        config={"api_key": "sk-or-test"},
    )
    session.commit()

    ollama = repo.list_for_user_of_type(user.id, ProviderType.OLLAMA.value)
    assert [c.id for c in ollama] == [first.id, second.id]


def test_delete_removes_row(session: Session) -> None:
    user = _create_user(session, "delete@example.com")
    repo = ProviderConnectionRepository(session)
    connection = repo.create(
        user_id=user.id,
        provider_type=ProviderType.OPENROUTER.value,
        label="OpenRouter",
        config={"api_key": "sk-or-test"},
    )
    session.commit()

    repo.delete(connection)
    session.commit()
    assert repo.list_for_user(user.id) == []
