"""Pinecone-less users can use every pgvector-backed surface.

There is no eager provider gate on routes anymore: prerequisites are enforced
lazily — `get_vector_store` rejects Pinecone use without a Pinecone
connection, and the provider registry rejects a missing embedding connection —
so a user with only an embedding-capable connection can run the whole
pgvector-backed flow.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.main import app
from app.db import models
from app.db.repositories import UserRepository
from tests.api.conftest import scaffold_default_pipelines
from tests.utils.providers import add_openrouter_connection


@pytest.fixture(name="keyless_user")
def keyless_user_fixture(session: Session) -> models.User:
    """A user with an OpenRouter connection but no Pinecone connection."""
    user = models.User(
        email="keyless@example.com",
        full_name="Keyless",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    connection = add_openrouter_connection(session, user)
    scaffold_default_pipelines(session, user, connection)
    return user


@pytest.fixture(name="keyless_client")
def keyless_client_fixture(session: Session, keyless_user: models.User) -> Iterator[TestClient]:
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: keyless_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


class _StubEmbedder:
    """Embedder stand-in returning fixed 3-dimension vectors."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 2, "total_tokens": 2}

    def embed_documents(self, chunks: Sequence[Any]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in chunks]

    def embed_query(self, _query: str) -> list[float]:
        return [0.1, 0.2, 0.3]


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, _user: models.User, _session: Session) -> None:
        pass

    def embedder(
        self, _connection_id: Any, model_name: str, dimensions: int | None = None
    ) -> _StubEmbedder:
        del dimensions
        return _StubEmbedder(model_name)

    def embedding_input_limit(self, _connection_id: Any, _model_name: str) -> int | None:
        return None


def test_collections_crud_without_pinecone_connection(keyless_client: TestClient) -> None:
    created = keyless_client.post("/api/collections", json={"name": "Docs", "description": ""})
    assert created.status_code == 201

    listed = keyless_client.get("/api/collections")
    assert listed.status_code == 200
    assert [collection["name"] for collection in listed.json()] == ["Docs"]


def test_ingest_and_search_on_pgvector_without_pinecone_connection(
    monkeypatch: pytest.MonkeyPatch,
    keyless_client: TestClient,
    pg_search_session: Session,
) -> None:
    """End to end on the default (pgvector) pipeline with only an embedding
    connection: upload a document, then query it back."""
    monkeypatch.setattr("app.services.ingestion.ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)

    created = keyless_client.post("/api/collections", json={"name": "Docs", "description": ""})
    assert created.status_code == 201
    collection_id = created.json()["id"]

    uploaded = keyless_client.post(
        f"/api/collections/{collection_id}/files",
        files={"file": ("doc.txt", b"Paris is the capital of France.", "text/plain")},
    )
    assert uploaded.status_code == 201, uploaded.text
    # TestClient runs the queued background ingestion before returning, so
    # the document is fully indexed by the time the query below runs.

    searched = keyless_client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "capital of France", "top_k": 3},
    )
    assert searched.status_code == 200, searched.text
    assert searched.json()["chunks"]
