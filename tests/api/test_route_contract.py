"""Cross-cutting HTTP-contract tests exercised through ``TestClient``.

These cover what a direct route-function call cannot: authentication gating,
cross-user ownership isolation (the highest-value bug class), request-body
validation, and response serialization that must never leak secrets. They are
deliberately resource-agnostic sweeps rather than per-route duplicates.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository, UserRepository
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.services.pipelines import PipelineService
from tests.utils.providers import TEST_EMBED_CONNECTION_ID


def _other_user(session: Session) -> models.User:
    user = models.User(
        email="other@example.com",
        full_name="Other",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


# --- 401: authentication is required on every protected router ---------------

@pytest.mark.parametrize(
    "path",
    [
        "/api/auth/me",
        "/api/connections",
        "/api/providers",
        "/api/models",
        "/api/collections",
        "/api/collections/stats",
        "/api/pipelines",
        "/api/chat/sessions",
        "/api/chat/prompt",
    ],
)
def test_protected_get_without_token_returns_401(unauthed_client, path: str) -> None:
    assert unauthed_client.get(path).status_code == 401


# --- 404: a resource owned by another user is invisible ----------------------

def test_cross_user_collection_is_404(client, session: Session) -> None:
    other = _other_user(session)
    collection = models.Collection(
        user_id=other.id, name="Theirs", description="", extra_metadata={}
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)

    assert client.get(f"/api/collections/{collection.id}").status_code == 404
    assert client.patch(f"/api/collections/{collection.id}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/collections/{collection.id}").status_code == 404


def test_cross_user_chat_session_is_404(client, session: Session) -> None:
    other = _other_user(session)
    chat_session = models.ChatSession(
        user_id=other.id,
        title="Theirs",
        mode=models.ChatMode.CHAT,
        chat_model="chat-model",
        context_tokens=0,
    )
    ChatRepository(session).add_session(chat_session)
    session.commit()
    session.refresh(chat_session)

    assert client.get(f"/api/chat/sessions/{chat_session.id}").status_code == 404
    assert client.delete(f"/api/chat/sessions/{chat_session.id}").status_code == 404


def test_cross_user_pipeline_is_404(client, session: Session) -> None:
    other = _other_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=other,
        name="Theirs",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()
    session.refresh(pipeline)

    assert client.get(f"/api/pipelines/{pipeline.id}").status_code == 404
    assert client.patch(f"/api/pipelines/{pipeline.id}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/pipelines/{pipeline.id}").status_code == 404


# --- 422: malformed create payloads are rejected before any handler ----------

def test_create_collection_missing_name_is_422(client) -> None:
    assert client.post("/api/collections", json={}).status_code == 422


def test_register_invalid_payload_is_422(client) -> None:
    # Short password (min_length=8) and no full_name shape.
    assert client.post("/api/auth/register", json={"email": "a@b.co", "password": "x"}).status_code == 422


def test_create_pipeline_missing_fields_is_422(client) -> None:
    assert client.post("/api/pipelines", json={}).status_code == 422


# --- serialization never leaks secrets ---------------------------------------

def test_me_response_excludes_secrets(client) -> None:
    body = client.get("/api/auth/me").json()

    for secret in ("hashed_password", "openrouter_api_key", "pinecone_api_key"):
        assert secret not in body


def test_connections_response_never_serializes_secret_values(client) -> None:
    """Connection reads echo `secrets_configured` booleans, never key values."""
    body = client.get("/api/connections").json()

    assert body, "expected the fixture user's connections"
    serialized = str(body)
    assert "openrouter-key" not in serialized
    assert "pinecone-key" not in serialized
    for connection in body:
        assert connection["secrets_configured"].get("api_key") is True
