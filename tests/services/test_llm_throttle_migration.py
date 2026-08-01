"""Stamping LLM throttle defaults onto existing connection rows."""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.services.llm_throttle_migration import stamp_llm_throttle_defaults


def _connection(
    user_id: object, provider_type: str, config: dict[str, object]
) -> models.ProviderConnection:
    return models.ProviderConnection(
        user_id=user_id, provider_type=provider_type, label=provider_type, config=config
    )


def _user(session: Session) -> models.User:
    user = models.User(
        id=uuid4(), email=f"throttle-{uuid4().hex[:8]}@test.local", hashed_password="hashed"
    )
    session.add(user)
    session.commit()
    return user


def test_stamps_chat_connections_and_leaves_the_rest(session: Session) -> None:
    user = _user(session)
    openrouter = _connection(user.id, "openrouter", {"api_key": "sk-or-x"})
    openai = _connection(
        user.id, "openai", {"api_key": "sk-x", "max_concurrent_requests": 32}
    )
    pinecone = _connection(user.id, "pinecone", {"api_key": "pc-x"})
    session.add(openrouter)
    session.add(openai)
    session.add(pinecone)
    session.commit()

    stamp_llm_throttle_defaults(session)

    with Session(session.get_bind()) as fresh:
        stamped = fresh.get(models.ProviderConnection, openrouter.id)
        assert stamped is not None
        # OpenRouter: concurrency default 8; no RPM default (paid models are
        # capped provider-side, not router-side).
        assert stamped.config["max_concurrent_requests"] == 8
        assert "requests_per_minute" not in stamped.config

        kept = fresh.get(models.ProviderConnection, openai.id)
        assert kept is not None
        # An explicit user value survives; the absent RPM gains the default.
        assert kept.config["max_concurrent_requests"] == 32
        assert kept.config["requests_per_minute"] == 500

        untouched = fresh.get(models.ProviderConnection, pinecone.id)
        assert untouched is not None
        assert untouched.config == {"api_key": "pc-x"}


def test_migration_is_idempotent(session: Session) -> None:
    user = _user(session)
    connection = _connection(user.id, "anthropic", {"api_key": "sk-ant-x"})
    session.add(connection)
    session.commit()

    stamp_llm_throttle_defaults(session)
    with Session(session.get_bind()) as fresh:
        row = fresh.get(models.ProviderConnection, connection.id)
        assert row is not None
        first = dict(row.config)
    assert first["max_concurrent_requests"] == 4
    assert first["requests_per_minute"] == 50

    stamp_llm_throttle_defaults(session)
    with Session(session.get_bind()) as fresh:
        row = fresh.get(models.ProviderConnection, connection.id)
        assert row is not None
        assert dict(row.config) == first
