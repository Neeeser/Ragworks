"""Behavior tests for provider adapter construction and resolution."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import ProviderConnectionRepository, UserRepository
from app.providers.ollama import OllamaAdapter
from app.providers.registry import (
    ProviderResolver,
    all_descriptors,
    build_adapter,
    get_provider,
    resolve_connection,
)
from app.retrieval.embedders.ollama_embedder import OllamaEmbedder
from app.schemas.enums import ProviderKind, ProviderType
from app.services.errors import InvalidInputError, NotFoundError


def _create_user(session: Session, email: str) -> models.User:
    repo = UserRepository(session)
    user = models.User(email=email, full_name="Example", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _ollama_connection(session: Session, user: models.User) -> models.ProviderConnection:
    connection = ProviderConnectionRepository(session).create(
        user_id=user.id,
        provider_type=ProviderType.OLLAMA.value,
        label="Homelab",
        config={"base_url": "http://192.168.1.225:11434"},
    )
    session.commit()
    return connection


def test_descriptors_cover_every_provider_type() -> None:
    types = {descriptor.provider_type for descriptor in all_descriptors()}
    assert types == set(ProviderType)


def test_build_adapter_rejects_unknown_type() -> None:
    connection = models.ProviderConnection(
        user_id=uuid4(), provider_type="acme", label="x", config={}
    )
    with pytest.raises(InvalidInputError, match="Unknown provider type"):
        build_adapter(connection)


def test_build_adapter_rejects_malformed_config() -> None:
    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.OLLAMA.value,
        label="x",
        config={"base_url": "not-a-url"},
    )
    with pytest.raises(InvalidInputError, match="Ollama connection configuration"):
        build_adapter(connection)


def test_get_provider_enforces_kind() -> None:
    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.PINECONE.value,
        label="Pinecone",
        config={"api_key": "pcsk_test"},
    )
    with pytest.raises(InvalidInputError, match="do not provide embedding models"):
        get_provider(connection, ProviderKind.EMBEDDING)
    assert get_provider(connection, ProviderKind.VECTOR_STORE) is not None


def test_resolve_connection_is_ownership_scoped(session: Session) -> None:
    owner = _create_user(session, "resolve-owner@example.com")
    other = _create_user(session, "resolve-other@example.com")
    connection = _ollama_connection(session, owner)

    assert resolve_connection(session, owner, connection.id).id == connection.id
    with pytest.raises(NotFoundError):
        resolve_connection(session, other, connection.id)
    with pytest.raises(NotFoundError):
        resolve_connection(session, owner, uuid4())


def test_provider_resolver_builds_and_caches_adapters(session: Session) -> None:
    user = _create_user(session, "resolver@example.com")
    connection = _ollama_connection(session, user)
    resolver = ProviderResolver(user, session)

    embedder = resolver.embedder(connection.id, "nomic-embed-text", dimensions=None)
    assert isinstance(embedder, OllamaEmbedder)
    assert embedder.model_name == "nomic-embed-text"

    first = resolver.adapter(connection.id, ProviderKind.EMBEDDING)
    second = resolver.adapter(connection.id, ProviderKind.EMBEDDING)
    assert first is second
    assert isinstance(first, OllamaAdapter)


def test_provider_resolver_reads_embedding_input_limit_from_cached_adapter(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _create_user(session, "limit-resolver@example.com")
    connection = _ollama_connection(session, user)
    resolver = ProviderResolver(user, session)
    adapter = resolver.adapter(connection.id, ProviderKind.EMBEDDING)
    monkeypatch.setattr(adapter, "embedding_input_limit", lambda _model: 2048)

    assert resolver.embedding_input_limit(connection.id, "nomic-embed-text") == 2048


def test_provider_adapter_has_a_reranker_factory() -> None:
    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.OLLAMA.value,
        label="Ollama",
        config={"base_url": "http://localhost:11434"},
    )
    adapter = build_adapter(connection)

    with pytest.raises(InvalidInputError, match="do not provide reranking models"):
        adapter.reranker("example")


def test_provider_adapter_kind_gate_uses_instance_kinds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.OLLAMA.value,
        label="Ollama",
        config={"base_url": "http://localhost:11434"},
    )
    adapter = build_adapter(connection)
    monkeypatch.setattr(
        OllamaAdapter,
        "kinds",
        property(lambda _self: (ProviderKind.RERANKING,)),
        raising=False,
    )

    adapter.require_kind(ProviderKind.RERANKING)
    with pytest.raises(InvalidInputError, match="do not provide embedding models"):
        adapter.require_kind(ProviderKind.EMBEDDING)
