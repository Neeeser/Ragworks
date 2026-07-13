"""HTTP contract for `/api/connections` and `/api/providers`."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.providers.ollama import OllamaAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.providers.pinecone import PineconeAdapter
from app.schemas.providers import ConnectionValidationResult

_ADAPTERS = (OpenRouterAdapter, OllamaAdapter, PineconeAdapter)


@pytest.fixture(autouse=True)
def _stub_live_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Connection saves probe the provider live — stub that per adapter class
    (each concrete adapter defines its own `validate_connection`)."""
    for adapter in _ADAPTERS:
        monkeypatch.setattr(
            adapter,
            "validate_connection",
            lambda self: ConnectionValidationResult(valid=True, message="Connected."),
        )


def test_provider_catalog_lists_types_with_kind_badges(client: TestClient) -> None:
    response = client.get("/api/providers")

    assert response.status_code == 200
    by_type = {entry["provider_type"]: entry for entry in response.json()}
    assert set(by_type) == {"openrouter", "ollama", "pinecone", "pgvector"}
    assert by_type["openrouter"]["kinds"] == ["embedding", "chat"]
    assert by_type["openrouter"]["recommended"] is True
    assert by_type["pinecone"]["kinds"] == ["vector_store"]
    assert by_type["pgvector"]["builtin"] is True
    ollama_fields = {field["name"]: field for field in by_type["ollama"]["config_fields"]}
    assert ollama_fields["base_url"]["kind"] == "url"
    assert ollama_fields["api_key"]["required"] is False


def test_create_list_and_delete_ollama_connection(client: TestClient) -> None:
    created = client.post(
        "/api/connections",
        json={
            "provider_type": "ollama",
            "label": "Homelab",
            "config": {"base_url": "http://192.168.1.225:11434"},
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["label"] == "Homelab"
    assert body["kinds"] == ["embedding", "chat"]
    assert body["config"] == {"base_url": "http://192.168.1.225:11434"}
    assert body["secrets_configured"] == {"api_key": False}

    listed = client.get("/api/connections")
    labels = [entry["label"] for entry in listed.json()]
    assert "Homelab" in labels

    deleted = client.delete(f"/api/connections/{body['id']}")
    assert deleted.status_code == 204
    remaining = [entry["label"] for entry in client.get("/api/connections").json()]
    assert "Homelab" not in remaining


def test_create_rejects_malformed_config(client: TestClient) -> None:
    response = client.post(
        "/api/connections",
        json={
            "provider_type": "ollama",
            "label": "Bad",
            "config": {"base_url": "not-a-url"},
        },
    )
    assert response.status_code == 400
    assert "http" in response.json()["detail"]


def test_create_rejects_invalid_credentials(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        OpenRouterAdapter,
        "validate_connection",
        lambda self: ConnectionValidationResult(valid=False, message="Invalid API key."),
    )
    response = client.post(
        "/api/connections",
        json={
            "provider_type": "openrouter",
            "label": "Bad key",
            "config": {"api_key": "sk-or-bad"},
        },
    )
    assert response.status_code == 400
    assert "Invalid API key" in response.json()["detail"]


def test_second_pinecone_connection_is_rejected(client: TestClient) -> None:
    """Pinecone's descriptor caps connections at one per user (fixture has one)."""
    response = client.post(
        "/api/connections",
        json={
            "provider_type": "pinecone",
            "label": "Second",
            "config": {"api_key": "pcsk_second"},
        },
    )
    assert response.status_code == 400
    assert "Only 1" in response.json()["detail"]


def test_update_rotates_secret_without_clearing_label(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    connection = client.get("/api/connections").json()[0]

    updated = client.patch(
        f"/api/connections/{connection['id']}",
        json={"config": {"api_key": "sk-or-rotated"}},
    )

    assert updated.status_code == 200
    assert updated.json()["label"] == connection["label"]
    stored = session.get(models.ProviderConnection, connection["id"])
    assert stored is not None
    assert stored.config["api_key"] == "sk-or-rotated"


def test_cross_user_connection_is_a_404(client: TestClient, session: Session) -> None:
    other = models.User(email="other@example.com", hashed_password="hashed")
    session.add(other)
    session.commit()
    session.refresh(other)
    foreign = models.ProviderConnection(
        user_id=other.id,
        provider_type="ollama",
        label="Foreign",
        config={"base_url": "http://10.0.0.9:11434"},
    )
    session.add(foreign)
    session.commit()

    assert client.delete(f"/api/connections/{foreign.id}").status_code == 404
    assert client.patch(
        f"/api/connections/{foreign.id}", json={"label": "Stolen"}
    ).status_code == 404
    assert client.delete(f"/api/connections/{uuid4()}").status_code == 404


def test_validate_unsaved_config_probe(client: TestClient) -> None:
    response = client.post(
        "/api/connections/validate",
        json={
            "provider_type": "ollama",
            "config": {"base_url": "http://192.168.1.225:11434"},
        },
    )
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_validate_unsaved_malformed_config_reports_invalid(client: TestClient) -> None:
    response = client.post(
        "/api/connections/validate",
        json={"provider_type": "ollama", "config": {"base_url": "nope"}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["message"]


def test_validate_saved_connection(client: TestClient) -> None:
    connection = client.get("/api/connections").json()[0]
    response = client.post(f"/api/connections/{connection['id']}/validate")
    assert response.status_code == 200
    assert response.json()["valid"] is True
