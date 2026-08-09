from __future__ import annotations

import logging

import pytest
from sqlmodel import Session

from app.db import models
from app.providers.openrouter import OpenRouterAdapter
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.provider_errors import ProviderErrorCode
from app.schemas.providers import (
    ConnectionCreate,
    ConnectionUpdate,
    ConnectionValidationResult,
)
from app.services import connections as connections_module
from app.services.connections import ConnectionService, connection_to_read
from app.services.errors import InvalidInputError
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
    assert result.config_valid is True


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
    # potential kinds keep the row visible, but `config_valid=False` tells the
    # frontend those kinds must not satisfy capability gates (they would
    # otherwise enable features the backend coverage check rejects).
    assert rows[0].kinds == [ProviderKind.EMBEDDING, ProviderKind.RERANKING]
    assert rows[0].config_valid is False


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


def test_draft_validate_never_writes_the_draft_to_the_stored_row(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A draft probe is a read: the typed-but-unsaved key must not be stored.

    The resolved row is session-tracked, so overlaying the draft onto it and
    letting an autoflush run would persist an unsaved secret against a config
    nobody saved.
    """
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-stored"}, label="OpenRouter"
    )
    probed: list[str] = []
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: probed.append(self._config.api_key) or ConnectionValidationResult(valid=True),
    )

    result = ConnectionService(session).validate_saved(
        user, connection.id, draft_config={"api_key": "sk-typed-but-unsaved"}
    )

    assert result.valid
    # The draft is what was probed...
    assert probed == ["sk-typed-but-unsaved"]
    # ...and the row it was probed against is untouched. Every request commits
    # its session on the way out (`session_scope`), so a draft written onto the
    # tracked row is a draft written to the database — commit here to put the
    # test on the same footing.
    session.commit()
    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.ProviderConnection, connection.id)
        assert stored is not None
        assert stored.config["api_key"] == "sk-stored"


def test_draft_validate_falls_back_to_the_stored_secret(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Testing a changed non-secret field uses the key the user never re-typed."""
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-stored"}, label="OpenRouter"
    )
    probed: list[str] = []
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: probed.append(self._config.api_key) or ConnectionValidationResult(valid=True),
    )

    ConnectionService(session).validate_saved(user, connection.id, draft_config={})

    assert probed == ["sk-stored"]


def test_draft_validate_leaves_the_stored_config_unverified(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A passing draft describes edits, not the config the row actually holds."""
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-stored"}, label="OpenRouter", verified=False
    )

    ConnectionService(session).validate_saved(
        user, connection.id, draft_config={"api_key": "sk-new"}
    )

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.ProviderConnection, connection.id)
        assert stored is not None
        assert stored.last_validated_at is None


def test_validate_saved_marks_the_stored_config_verified(session: Session) -> None:
    """The row's own passing probe is what makes it usable again."""
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-stored"}, label="OpenRouter", verified=False
    )

    ConnectionService(session).validate_saved(user, connection.id)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.ProviderConnection, connection.id)
        assert stored is not None
        assert stored.last_validated_at is not None


def test_create_stores_a_connection_the_provider_refused(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A down server must not stop the connection being added."""
    user = _user(session)
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: ConnectionValidationResult(valid=False, message="Connection refused."),
    )

    created = ConnectionService(session).create(
        user,
        ConnectionCreate(
            provider_type=ProviderType.OPENROUTER,
            label="OpenRouter",
            config={"api_key": "sk-test"},
            skip_validation=True,
        ),
    )

    assert created.last_validated_at is None
    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.ProviderConnection, created.id)
        assert stored is not None
        assert stored.config["api_key"] == "sk-test"


def test_create_still_refuses_a_failed_probe_by_default(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Skipping the probe is opt-in, and the refusal says why in a code."""
    user = _user(session)
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: ConnectionValidationResult(valid=False, message="Connection refused."),
    )

    with pytest.raises(InvalidInputError) as excinfo:
        ConnectionService(session).create(
            user,
            ConnectionCreate(
                provider_type=ProviderType.OPENROUTER,
                label="OpenRouter",
                config={"api_key": "sk-test"},
            ),
        )

    detail = excinfo.value.detail
    assert isinstance(detail, dict)
    # Classified, so the client can offer to save anyway rather than showing a
    # dead end — the sibling 400s on this route (unknown type, the per-user
    # cap) carry a plain string and must stay distinguishable from this.
    assert detail["code"] == ProviderErrorCode.CONNECTION.value
    assert detail["message"] == "Connection refused."


def test_update_clears_verification_when_the_config_changes(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The config that answered the last probe is gone, so its stamp is too."""
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-old"}, label="OpenRouter"
    )
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: ConnectionValidationResult(valid=False, message="Connection refused."),
    )

    updated = ConnectionService(session).update(
        user, connection.id, ConnectionUpdate(config={"api_key": "sk-new"}, skip_validation=True)
    )

    assert updated.last_validated_at is None
    assert updated.config == {}


def test_an_unverified_connection_does_not_satisfy_a_capability_gate(
    session: Session,
) -> None:
    """Nothing has established what a never-probed server actually serves."""
    user = _user(session)
    add_connection(
        session, user, "openrouter", {"api_key": "sk-test"}, label="OpenRouter", verified=False
    )

    assert ConnectionService(session).coverage(user).has_chat is False
