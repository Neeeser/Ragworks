"""HTTP contract for `/api/setup`: auth gating, status shape, error translation.

The ``auth_user`` fixture carries a Pinecone key, and status derivation lists
indexes across usable backends — so these tests stub ``get_vector_store`` at
the setup-service boundary (the suite never hits live providers).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services.errors import NotFoundError
from app.vectorstores.base import VectorIndexDescription


class _EmptyStore:
    """A vector store with no indexes, for offline status/bootstrap tests."""

    def list_indexes(self) -> list[VectorIndexDescription]:
        return []

    def describe_index(self, name: str) -> VectorIndexDescription:
        raise NotFoundError(f"index '{name}' not found.")


@pytest.fixture(autouse=True)
def _offline_vector_stores(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.setup.get_vector_store",
        lambda backend, *, user, session: _EmptyStore(),
    )


def test_setup_status_requires_auth(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/setup/status").status_code == 401


def test_setup_bootstrap_requires_auth(unauthed_client: TestClient) -> None:
    assert unauthed_client.post("/api/setup/bootstrap", json={}).status_code == 401


def test_setup_status_shape(client: TestClient) -> None:
    response = client.get("/api/setup/status")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "has_embedding_provider",
        "has_chat_provider",
        "has_vector_store",
        "has_index",
        "has_collection",
        "setup_complete",
    }
    # The auth_user fixture has connections but no index/collection yet.
    assert body["has_embedding_provider"] is True
    assert body["has_chat_provider"] is True
    assert body["setup_complete"] is False


def test_setup_bootstrap_validates_body(client: TestClient) -> None:
    assert client.post("/api/setup/bootstrap", json={}).status_code == 422


def test_setup_bootstrap_translates_domain_errors(client: TestClient, auth_user, session) -> None:
    connection = _openrouter_connection_id(session, auth_user)
    response = client.post(
        "/api/setup/bootstrap",
        json={
            "embedding_connection_id": connection,
            "embedding_model": "some/model",
            "backend": "pgvector",
            "index_name": "does-not-exist",
            "collection_name": "First",
        },
    )

    assert response.status_code == 400


def _openrouter_connection_id(session, user) -> str:
    from app.db.repositories import ProviderConnectionRepository

    rows = ProviderConnectionRepository(session).list_for_user_of_type(user.id, "openrouter")
    return str(rows[0].id)


def test_setup_bootstrap_returns_the_created_collection(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, auth_user, session
) -> None:
    """Regression: the response shaping used `model_validate(collection)`,
    which 500s because the db column `extra_metadata` is the schema field
    `metadata` — the wire shape must be built field-by-field."""

    class _MatchingStore(_EmptyStore):
        def describe_index(self, name: str) -> VectorIndexDescription:
            return VectorIndexDescription(name=name, backend="pgvector", dimension=384)

    monkeypatch.setattr(
        "app.services.setup.get_vector_store",
        lambda backend, *, user, session: _MatchingStore(),
    )
    response = client.post(
        "/api/setup/bootstrap",
        json={
            "embedding_connection_id": _openrouter_connection_id(session, auth_user),
            "embedding_model": "some/model",
            "embedding_dimension": 384,
            "backend": "pgvector",
            "index_name": "ragworks",
            "collection_name": "First",
        },
    )

    assert response.status_code == 201
    body = response.json()["collection"]
    assert body["name"] == "First"
    assert body["ingest_pipeline_id"] is not None
    assert len(body["tools"]) == 1
    assert body["tools"][0]["is_primary"] is True
    assert response.json()["warnings"]
