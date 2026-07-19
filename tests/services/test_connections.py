from __future__ import annotations

import logging

import pytest
from sqlmodel import Session

from app.db import models
from app.providers.openrouter import OpenRouterAdapter
from app.schemas.enums import ProviderKind
from app.schemas.providers import (
    ConnectionUpdate,
    ConnectionValidationResult,
)
from app.services import connections as connections_module
from app.services.connections import ConnectionService, connection_to_read
from tests.utils.providers import add_connection


def _user(session: Session) -> models.User:
    user = models.User(email="connections@example.com", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(autouse=True)
def _valid_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: ConnectionValidationResult(valid=True),
    )


def test_update_invalidates_resources_derived_from_old_config(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-old"}, label="OpenRouter"
    )
    invalidated_configs: list[dict[str, object]] = []
    invalidated_dimensions: list[object] = []
    monkeypatch.setattr(
        connections_module,
        "invalidate_connection_caches",
        lambda old: invalidated_configs.append(dict(old.config)),
        raising=False,
    )
    monkeypatch.setattr(
        connections_module,
        "invalidate_embedding_dimensions",
        lambda connection_id: invalidated_dimensions.append(connection_id),
        raising=False,
    )

    ConnectionService(session).update(
        user, connection.id, ConnectionUpdate(config={"api_key": "sk-new"})
    )

    assert invalidated_configs == [{"api_key": "sk-old"}]
    assert invalidated_dimensions == [connection.id]


def test_delete_invalidates_resources_after_commit(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-delete"}, label="OpenRouter"
    )
    invalidated: list[object] = []
    monkeypatch.setattr(
        connections_module,
        "invalidate_connection_caches",
        lambda old: invalidated.append(old.id),
        raising=False,
    )
    monkeypatch.setattr(
        connections_module,
        "invalidate_embedding_dimensions",
        lambda connection_id: invalidated.append(connection_id),
        raising=False,
    )

    ConnectionService(session).delete(user, connection.id)

    assert invalidated == [connection.id, connection.id]


def test_committed_update_survives_cache_cleanup_failure(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-old"}, label="Before"
    )

    def _fail(_connection: models.ProviderConnection) -> None:
        raise RuntimeError("close failed")

    monkeypatch.setattr(
        connections_module, "invalidate_connection_caches", _fail, raising=False
    )
    monkeypatch.setattr(
        connections_module,
        "invalidate_embedding_dimensions",
        lambda _connection_id: None,
        raising=False,
    )

    with caplog.at_level(logging.WARNING):
        result = ConnectionService(session).update(
            user, connection.id, ConnectionUpdate(label="After")
        )

    assert result.label == "After"
    assert "Cache cleanup failed" in caplog.text


def test_connection_read_uses_configured_adapter_kinds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = models.ProviderConnection(
        provider_type="openrouter",
        label="Dynamic",
        config={"api_key": "secret"},
    )
    monkeypatch.setattr(
        OpenRouterAdapter,
        "kinds",
        property(lambda _self: (ProviderKind.RERANKING,)),
        raising=False,
    )

    result = connection_to_read(connection)

    assert result.kinds == [ProviderKind.RERANKING]


def test_list_connections_renders_rows_with_malformed_stored_config(
    session: Session,
) -> None:
    """A row whose stored config no longer validates still lists (and is deletable).

    Regression: `connection_to_read` began constructing the real adapter, whose
    config parse raises `InvalidInputError` — one malformed row turned the whole
    connections listing (and every hasKind gate built on it) into a 400.
    """
    user = _user(session)
    add_connection(session, user, "tei", {"base_url": ""}, label="Broken TEI")

    rows = ConnectionService(session).list_connections(user)

    assert [row.label for row in rows] == ["Broken TEI"]
    # Capability probing is impossible without a valid config; the descriptor's
    # potential kinds keep the row visible.
    assert rows[0].kinds == [ProviderKind.EMBEDDING, ProviderKind.RERANKING]


def test_coverage_uses_configured_adapter_kinds(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(session)
    add_connection(
        session, user, "openrouter", {"api_key": "secret"}, label="Dynamic"
    )
    monkeypatch.setattr(
        OpenRouterAdapter,
        "kinds",
        property(lambda _self: (ProviderKind.RERANKING,)),
        raising=False,
    )
    monkeypatch.setattr(connections_module, "pgvector_available", lambda: False)

    result = ConnectionService(session).coverage(user)

    assert result.has_reranking is True
    assert result.has_embedding is False
    assert result.has_chat is False
    assert result.has_vector_store is False
