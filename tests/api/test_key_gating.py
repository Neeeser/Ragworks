"""Pinecone-less users can use every pgvector-backed surface.

The routes that used to require both provider keys (`require_user_api_keys`)
now require only an OpenRouter key; the Pinecone key is enforced lazily by
`get_vector_store` when a pipeline actually uses the Pinecone backend.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.main import app
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.openrouter import OpenRouterEmbeddingsResponse


@pytest.fixture(name="keyless_user")
def keyless_user_fixture(session: Session) -> models.User:
    """A user with an OpenRouter key but no Pinecone key."""
    user = models.User(
        email="keyless@example.com",
        full_name="Keyless",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key=None,
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(name="keyless_client")
def keyless_client_fixture(session: Session, keyless_user: models.User) -> Iterator[TestClient]:
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: keyless_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


class _StubOpenRouterClient:
    def embed(
        self,
        texts: object,
        model: str | None = None,
        extra_headers: dict[str, str] | None = None,
        dimensions: int | None = None,
    ) -> OpenRouterEmbeddingsResponse:
        texts = list(texts)  # type: ignore[arg-type]
        return OpenRouterEmbeddingsResponse.model_validate(
            {
                "data": [{"embedding": [0.1, 0.2, 0.3]} for _ in texts],
                "usage": {"prompt_tokens": 2, "total_tokens": 2},
            }
        )


def test_collections_crud_without_pinecone_key(keyless_client: TestClient) -> None:
    created = keyless_client.post("/api/collections", json={"name": "Docs", "description": ""})
    assert created.status_code == 201

    listed = keyless_client.get("/api/collections")
    assert listed.status_code == 200
    assert [collection["name"] for collection in listed.json()] == ["Docs"]


def test_ingest_and_search_on_pgvector_without_pinecone_key(
    monkeypatch: pytest.MonkeyPatch,
    keyless_client: TestClient,
    pgvector_session: Session,
) -> None:
    """End to end on the default (pgvector) pipeline with only an OpenRouter key:
    upload a document, then query it back."""
    monkeypatch.setattr(
        "app.services.ingestion.get_openrouter_client",
        lambda *_a, **_k: _StubOpenRouterClient(),
    )
    monkeypatch.setattr(
        "app.services.retrieval.get_openrouter_client",
        lambda *_a, **_k: _StubOpenRouterClient(),
    )

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
