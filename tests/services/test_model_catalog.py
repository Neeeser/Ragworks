"""Unified model catalog: aggregation across connections + per-connection degradation."""

from __future__ import annotations

import httpx
import pytest
from sqlmodel import Session

from app.db import models
from app.providers.ollama import OllamaAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import CatalogModel
from app.services.errors import InvalidInputError
from app.services.model_catalog import (
    list_models_for_user,
    list_openrouter_model_endpoints,
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
        lambda self, kind: [_entry(self, "openai/text-embedding-3-small", 1536)],
    )
    monkeypatch.setattr(
        OllamaAdapter,
        "list_models",
        lambda self, kind: [_entry(self, "nomic-embed-text", 768)],
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
        lambda self, kind: [_entry(self, "openai/gpt-oss-120b")],
    )

    def _unreachable(self, kind):
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


def test_endpoint_directory_is_openrouter_only(session: Session) -> None:
    user = _user(session)
    ollama = add_connection(
        session, user, "ollama", {"base_url": "http://10.0.0.5:11434"}, label="Homelab"
    )

    with pytest.raises(InvalidInputError, match="OpenRouter connections"):
        list_openrouter_model_endpoints(session, user, ollama.id, "openai", "gpt-4")
