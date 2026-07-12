"""HTTP contract for the backend-aware `/api/indexes` routes."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.dependencies import get_current_user, get_session
from app.api.main import app
from app.db import models
from app.db.repositories import UserRepository


@pytest.fixture(name="keyless_user")
def keyless_user_fixture(session: Session) -> models.User:
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


def test_backends_endpoint_reports_capabilities_and_configuration(
    keyless_client: TestClient,
) -> None:
    response = keyless_client.get("/api/indexes/backends")

    assert response.status_code == 200
    backends = {entry["backend"]: entry for entry in response.json()["backends"]}
    assert set(backends) == {"pgvector", "pinecone"}

    pgvector = backends["pgvector"]
    assert pgvector["configured"] is True
    assert pgvector["capabilities"]["max_dimension"] == 4096
    assert pgvector["capabilities"]["requires_api_key"] is False
    assert pgvector["capabilities"]["supported_vector_types"] == ["dense", "sparse"]

    pinecone = backends["pinecone"]
    assert pinecone["configured"] is False  # no key stored
    assert pinecone["capabilities"]["max_dimension"] == 20000
    assert "sparse" in pinecone["capabilities"]["supported_vector_types"]


def test_pgvector_index_crud_round_trip(
    keyless_client: TestClient, pgvector_session: Session
) -> None:
    created = keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs", "dimension": 8, "metric": "cosine"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["backend"] == "pgvector"
    assert body["dimension"] == 8

    listed = keyless_client.get("/api/indexes", params={"backend": "pgvector"})
    assert [index["name"] for index in listed.json()["indexes"]] == ["docs"]

    described = keyless_client.get("/api/indexes/docs", params={"backend": "pgvector"})
    assert described.status_code == 200
    assert described.json()["metric"] == "cosine"

    deleted = keyless_client.delete("/api/indexes/docs", params={"backend": "pgvector"})
    assert deleted.status_code == 200
    assert (
        keyless_client.get("/api/indexes", params={"backend": "pgvector"}).json()["indexes"] == []
    )


def test_index_lifecycle_records_telemetry(
    keyless_client: TestClient, pgvector_session: Session
) -> None:
    keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs", "dimension": 8},
    )
    keyless_client.delete("/api/indexes/docs", params={"backend": "pgvector"})

    rows = pgvector_session.exec(select(models.TelemetryEventRow)).all()
    events = {row.event_type: row for row in rows}
    assert "index.created" in events
    assert events["index.created"].payload["backend"] == "pgvector"
    assert events["index.created"].payload["index_name"] == "docs"
    assert events["index.created"].payload["dimension"] == 8
    assert "index.deleted" in events
    assert events["index.deleted"].payload["backend"] == "pgvector"


def test_create_rejects_dimension_over_backend_max(keyless_client: TestClient) -> None:
    response = keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs", "dimension": 4097},
    )
    assert response.status_code == 400
    assert "4096" in response.json()["detail"]


def test_create_rejects_unsupported_metric(keyless_client: TestClient) -> None:
    response = keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs", "dimension": 8, "metric": "euclidean"},
    )
    assert response.status_code == 400
    assert "metric" in response.json()["detail"].lower()


def test_create_sparse_on_pgvector_round_trips(
    keyless_client: TestClient, pg_search_session: Session
) -> None:
    """Sparse (BM25) indexes are first-class on pgvector via pg_search."""
    created = keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs-bm25", "vector_type": "sparse"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["vector_type"] == "sparse"
    assert body["dimension"] is None
    assert body["metric"] == "bm25"

    deleted = keyless_client.delete("/api/indexes/docs-bm25", params={"backend": "pgvector"})
    assert deleted.status_code == 200


def test_create_sparse_on_pgvector_rejected_without_pg_search(
    keyless_client: TestClient,
) -> None:
    """Without the pg_search extension, sparse creation is a clear 400."""
    from app.db.pg_search_support import set_pg_search_available

    set_pg_search_available(False)
    response = keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs-bm25", "vector_type": "sparse"},
    )
    assert response.status_code == 400
    assert "pg_search" in response.json()["detail"]


def test_pinecone_operations_require_key(keyless_client: TestClient) -> None:
    listed = keyless_client.get("/api/indexes", params={"backend": "pinecone"})
    assert listed.status_code == 400
    assert "Pinecone API key" in listed.json()["detail"]

    created = keyless_client.post(
        "/api/indexes",
        json={"backend": "pinecone", "name": "docs", "dimension": 1536},
    )
    assert created.status_code == 400


def test_list_without_backend_returns_usable_backends_only(
    keyless_client: TestClient, pgvector_session: Session
) -> None:
    """With no Pinecone key, the unfiltered list covers pgvector alone —
    no 400, no Pinecone client construction."""
    keyless_client.post(
        "/api/indexes",
        json={"backend": "pgvector", "name": "docs", "dimension": 8},
    )
    response = keyless_client.get("/api/indexes")
    assert response.status_code == 200
    assert [(idx["backend"], idx["name"]) for idx in response.json()["indexes"]] == [
        ("pgvector", "docs")
    ]


def test_describe_missing_index_is_404(keyless_client: TestClient) -> None:
    response = keyless_client.get("/api/indexes/missing", params={"backend": "pgvector"})
    assert response.status_code == 404


def test_indexes_require_auth(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/indexes").status_code == 401
    assert unauthed_client.get("/api/indexes/backends").status_code == 401
