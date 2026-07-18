"""Unified model catalog: aggregation across connections + per-connection degradation."""

from __future__ import annotations

import threading

import httpx
import pytest
from sqlmodel import Session

from app.clients.tei.schemas import TEIInfo
from app.db import models
from app.providers.base import CatalogResult
from app.providers.ollama import OllamaAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.providers.tei import TEIAdapter
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import CatalogMetadata, CatalogModel
from app.services.errors import InvalidInputError
from app.services.model_catalog import (
    list_models_for_user,
    list_openrouter_model_endpoints,
    resolve_embedding_dimension,
)
from tests.utils.providers import add_connection, add_openrouter_connection


def _user(session: Session) -> models.User:
    user = models.User(email="catalog@example.com", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _entry(adapter, model_id: str, dimension: int | None = None) -> CatalogModel:
    return CatalogModel(
        connection_id=adapter.connection.id,
        connection_label=adapter.connection.label,
        provider_type=adapter.provider_type,
        id=model_id,
        name=model_id,
        dimension=dimension,
    )


def _result(
    adapter,
    model_id: str,
    *,
    freshness: str = "fresh",
    age_seconds: float = 0,
    refreshing: bool = False,
    warning: str | None = None,
) -> CatalogResult:
    return CatalogResult(
        models=[_entry(adapter, model_id)],
        meta=CatalogMetadata(
            freshness=freshness,
            age_seconds=age_seconds,
            refreshing=refreshing,
            warning=warning,
        ),
    )


def test_models_aggregate_across_connections(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    add_openrouter_connection(session, user)
    add_connection(
        session, user, "ollama", {"base_url": "http://10.0.0.5:11434"}, label="Homelab"
    )
    monkeypatch.setattr(
        OpenRouterAdapter,
        "list_models",
        lambda self, kind, force_refresh=False: CatalogResult(
            models=[_entry(self, "openai/text-embedding-3-small", 1536)],
            meta=CatalogMetadata(),
        ),
    )
    monkeypatch.setattr(
        OllamaAdapter,
        "list_models",
        lambda self, kind, force_refresh=False: CatalogResult(
            models=[_entry(self, "nomic-embed-text", 768)],
            meta=CatalogMetadata(),
        ),
    )

    catalog = list_models_for_user(session, user, ProviderKind.EMBEDDING)

    assert {model.id for model in catalog.models} == {
        "openai/text-embedding-3-small",
        "nomic-embed-text",
    }
    assert {model.provider_type for model in catalog.models} == {
        ProviderType.OPENROUTER,
        ProviderType.OLLAMA,
    }
    assert catalog.connection_errors == []
    assert catalog.meta == CatalogMetadata()


def test_one_unreachable_connection_degrades_instead_of_failing(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    add_openrouter_connection(session, user)
    add_connection(
        session, user, "ollama", {"base_url": "http://10.0.0.5:11434"}, label="Homelab"
    )
    monkeypatch.setattr(
        OpenRouterAdapter,
        "list_models",
        lambda self, kind, force_refresh=False: _result(self, "openai/gpt-oss-120b"),
    )

    def _unreachable(self, kind, force_refresh=False):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(OllamaAdapter, "list_models", _unreachable)

    catalog = list_models_for_user(session, user, ProviderKind.CHAT)

    assert [model.id for model in catalog.models] == ["openai/gpt-oss-120b"]
    assert len(catalog.connection_errors) == 1
    assert catalog.connection_errors[0].connection_label == "Homelab"
    assert "refused" in catalog.connection_errors[0].message


def test_kind_filter_skips_connections_without_the_kind(session: Session) -> None:
    user = _user(session)
    add_connection(session, user, "pinecone", {"api_key": "pcsk_x"}, label="Pinecone")

    catalog = list_models_for_user(session, user, ProviderKind.CHAT)

    assert catalog.models == []
    assert catalog.connection_errors == []
    assert catalog.meta == CatalogMetadata()


def test_kind_filter_uses_the_configured_tei_task(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    add_connection(
        session,
        user,
        "tei",
        {"base_url": "http://tei.test:8080"},
        label="Embedding TEI",
    )
    monkeypatch.setattr(
        TEIAdapter,
        "_info",
        lambda _self, _force_refresh=False: TEIInfo(
            model_id="BAAI/bge-small-en-v1.5",
            model_type={"embedding": {"pooling": "mean"}},
            max_input_length=512,
        ),
    )

    catalog = list_models_for_user(session, user, ProviderKind.RERANKING)

    assert catalog.models == []
    assert catalog.connection_errors == []


def test_metadata_aggregates_stale_refreshing_and_warning(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    add_openrouter_connection(session, user)
    add_connection(
        session, user, "ollama", {"base_url": "http://10.0.0.5:11434"}, label="Homelab"
    )
    monkeypatch.setattr(
        OpenRouterAdapter,
        "list_models",
        lambda self, kind, force_refresh=False: _result(
            self,
            "openai/gpt-4",
            freshness="stale",
            age_seconds=42,
            refreshing=True,
            warning="refresh delayed",
        ),
    )
    monkeypatch.setattr(
        OllamaAdapter,
        "list_models",
        lambda self, kind, force_refresh=False: _result(
            self, "llama3", age_seconds=3
        ),
    )

    catalog = list_models_for_user(session, user, ProviderKind.CHAT)

    assert catalog.meta.freshness == "stale"
    assert catalog.meta.age_seconds == 42
    assert catalog.meta.refreshing is True
    assert catalog.meta.warning == "refresh delayed"


def test_forced_refresh_runs_connections_in_parallel_and_preserves_order(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    add_connection(
        session, user, "openrouter", {"api_key": "sk-test"}, label="First"
    )
    add_connection(
        session, user, "ollama", {"base_url": "http://10.0.0.5:11434"}, label="Second"
    )
    both_started = threading.Barrier(2)
    release_first = threading.Event()
    seen_force: list[bool] = []

    def _openrouter(self, kind, force_refresh=False):
        seen_force.append(force_refresh)
        both_started.wait(timeout=1)
        assert release_first.wait(timeout=1)
        return _result(self, "first-model")

    def _ollama(self, kind, force_refresh=False):
        seen_force.append(force_refresh)
        both_started.wait(timeout=1)
        release_first.set()
        return _result(self, "second-model")

    monkeypatch.setattr(OpenRouterAdapter, "list_models", _openrouter)
    monkeypatch.setattr(OllamaAdapter, "list_models", _ollama)

    catalog = list_models_for_user(
        session, user, ProviderKind.CHAT, force_refresh=True
    )

    assert seen_force == [True, True]
    assert [model.id for model in catalog.models] == ["first-model", "second-model"]


def test_endpoint_directory_is_openrouter_only(session: Session) -> None:
    user = _user(session)
    ollama = add_connection(
        session, user, "ollama", {"base_url": "http://10.0.0.5:11434"}, label="Homelab"
    )

    with pytest.raises(InvalidInputError, match="OpenRouter connections"):
        list_openrouter_model_endpoints(session, user, ollama.id, "openai", "gpt-4")


def test_embedding_dimensions_are_cached_by_connection_and_model(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    first = add_connection(
        session, user, "openrouter", {"api_key": "sk-first"}, label="First"
    )
    second = add_connection(
        session, user, "openrouter", {"api_key": "sk-second"}, label="Second"
    )
    calls: list[tuple[object, str]] = []

    def _dimension(self, model_id: str) -> int:
        calls.append((self.connection.id, model_id))
        return 1536 if self.connection.id == first.id else 3072

    monkeypatch.setattr(OpenRouterAdapter, "embedding_dimension", _dimension)

    first_result = resolve_embedding_dimension(
        session, user, first.id, "shared/model"
    )
    second_result = resolve_embedding_dimension(
        session, user, second.id, "shared/model"
    )
    cached_first = resolve_embedding_dimension(
        session, user, first.id, "shared/model"
    )

    assert first_result.dimension == 1536
    assert second_result.dimension == 3072
    assert cached_first.dimension == 1536
    assert calls == [(first.id, "shared/model"), (second.id, "shared/model")]


def test_unknown_embedding_dimension_is_reprobed_next_lookup(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _user(session)
    connection = add_connection(
        session, user, "openrouter", {"api_key": "sk-unknown-dim"}, label="Probe"
    )
    results = iter([None, 1536])
    calls = 0

    def _dimension(self, model_id: str) -> int | None:
        nonlocal calls
        calls += 1
        return next(results)

    monkeypatch.setattr(OpenRouterAdapter, "embedding_dimension", _dimension)

    first = resolve_embedding_dimension(session, user, connection.id, "acme/embed")
    second = resolve_embedding_dimension(session, user, connection.id, "acme/embed")
    third = resolve_embedding_dimension(session, user, connection.id, "acme/embed")

    assert first.dimension is None
    assert second.dimension == 1536
    assert third.dimension == 1536
    assert calls == 2
