"""HTTP-contract tests for the collection diagnostics endpoint."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.db.repositories import PipelineRepository, UserRepository
from app.services.pipeline_scaffolds import DEFAULT_INGEST_SLUG, DEFAULT_SEARCH_SLUG
from tests.utils.providers import install_scaffolded_pipelines


def _default_pipeline(session: Session, user: models.User, slug: str) -> models.Pipeline:
    """The user's scaffolded default pipeline for a template slug."""
    return next(
        p for p in PipelineRepository(session).list_for_user(user.id) if p.template_slug == slug
    )


def _collection_for(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Docs", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_diagnostics_requires_auth(unauthed_client: TestClient):
    """No token -> 401 before any collection lookup."""
    response = unauthed_client.get(f"/api/collections/{uuid4()}/diagnostics")
    assert response.status_code == 401


def test_diagnostics_cross_user_is_404(client: TestClient, session: Session):
    """A collection owned by another user is not visible (404)."""
    other = models.User(email="other@example.com", full_name="Other", hashed_password="x")
    UserRepository(session).add(other)
    session.commit()
    session.refresh(other)
    install_scaffolded_pipelines(session, other)
    collection = _collection_for(session, other)
    response = client.get(f"/api/collections/{collection.id}/diagnostics")
    assert response.status_code == 404


def test_diagnostics_response_shape(client: TestClient, session: Session, auth_user: models.User):
    """A valid request returns the aggregate diagnostics response shape."""
    collection = _collection_for(session, auth_user)
    response = client.get(f"/api/collections/{collection.id}/diagnostics")
    assert response.status_code == 200
    body = response.json()
    assert body["collection_id"] == str(collection.id)
    assert set(body) >= {
        "error_count",
        "warning_count",
        "consistent",
        "diagnostics",
        "generated_at",
    }
    assert isinstance(body["diagnostics"], list)


def test_preview_requires_auth(unauthed_client: TestClient):
    """No token -> 401 before any pipeline is read."""
    response = unauthed_client.post("/api/collections/diagnostics/preview", json={})
    assert response.status_code == 401


def test_preview_returns_the_summary_shape(
    client: TestClient, auth_user: models.User, session: Session
):
    """A preview over the user's default pipelines returns the summary shape."""
    install_scaffolded_pipelines(session, auth_user)
    ingestion = _default_pipeline(session, auth_user, DEFAULT_INGEST_SLUG)
    retrieval = _default_pipeline(session, auth_user, DEFAULT_SEARCH_SLUG)

    response = client.post(
        "/api/collections/diagnostics/preview",
        json={
            "ingest_pipeline_id": str(ingestion.id),
            "tool_pipeline_ids": [str(retrieval.id)],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "generated_at",
        "error_count",
        "warning_count",
        "consistent",
        "diagnostics",
    }
    assert isinstance(body["diagnostics"], list)


def test_preview_ignores_another_users_pipeline(
    client: TestClient, session: Session, auth_user: models.User
):
    """A pipeline the caller does not own resolves to nothing, never its settings."""
    other = models.User(email="other-preview@example.com", full_name="Other", hashed_password="x")
    UserRepository(session).add(other)
    session.commit()
    session.refresh(other)
    install_scaffolded_pipelines(session, other, embedding_model="foreign-model")
    foreign = _default_pipeline(session, other, DEFAULT_SEARCH_SLUG)
    install_scaffolded_pipelines(session, auth_user)
    ingestion = _default_pipeline(session, auth_user, DEFAULT_INGEST_SLUG)

    response = client.post(
        "/api/collections/diagnostics/preview",
        json={
            "ingest_pipeline_id": str(ingestion.id),
            "tool_pipeline_ids": [str(foreign.id)],
        },
    )

    assert response.status_code == 200
    codes = {d["code"] for d in response.json()["diagnostics"]}
    assert "embedding_model_mismatch" not in codes
