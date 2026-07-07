"""HTTP-contract tests for the four config enforcement sites.

Each test flips a config field through `AppSettingRepository` (the same
DB-backed override path the admin PATCH route writes through) and invalidates
`get_app_config`'s process cache, mirroring the idiom in
`tests/api/test_config_routes.py` and `tests/services/test_app_config_service.py`.
The autouse `_invalidate_cache` fixture below resets the cache around every
test in this module for the same reason: route tests hit the module-level
cache, not a fresh service per call.

Upload-limit note: `UploadFile.size` (Starlette) is `None` for some transports;
the size cap enforced in `upload_document` is best-effort and falls through
when `size` is unavailable -- the content-type check still applies regardless.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes import documents as documents_routes
from app.db import models
from app.db.repositories import AppSettingRepository
from app.schemas.documents import DocumentRead, IngestionResponse
from app.services.app_config import invalidate_app_config_cache


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Ensure `get_app_config`'s process-wide cache never leaks across tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _set_override(session: Session, key: str, value: object) -> None:
    AppSettingRepository(session).upsert(key, value, updated_by=None)
    session.commit()
    invalidate_app_config_cache()


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


class _StubIngestionService:
    """Stand-in for IngestionService so upload tests never hit real ingestion."""

    def __init__(self, _session: Session) -> None:
        pass

    def ingest_upload(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        filename: str | None,
        content_type: str | None,
        stream: object,
    ) -> IngestionResponse:
        now = datetime.datetime.now(datetime.UTC)
        document = DocumentRead(
            id=uuid4(),
            collection_id=collection.id,
            name=filename or "doc.txt",
            content_type=content_type or "text/plain",
            status=models.DocumentStatus.READY,
            num_chunks=1,
            num_tokens=1,
            chunk_size=100,
            chunk_overlap=0,
            chunk_strategy=models.ChunkStrategy.TOKEN,
            created_at=now,
            updated_at=now,
        )
        return IngestionResponse(
            document=document,
            chunk_count=1,
            pinecone_namespace="ns",
            embedding_model="test-embed",
            usage={},
        )


# --- Enforcement 1: registration flag -----------------------------------


def test_register_returns_403_when_registration_disabled(
    unauthed_client: TestClient, session: Session
) -> None:
    _set_override(session, "auth.allow_registration", False)

    response = unauthed_client.post(
        "/api/auth/register",
        json={"email": "new@example.com", "password": "password123", "full_name": "New"},
    )

    assert response.status_code == 403


def test_register_succeeds_when_registration_enabled(
    unauthed_client: TestClient, session: Session
) -> None:
    _set_override(session, "auth.allow_registration", True)

    response = unauthed_client.post(
        "/api/auth/register",
        json={"email": "new2@example.com", "password": "password123", "full_name": "New"},
    )

    assert response.status_code == 201


# --- Enforcement 2: upload size and content-type limits -----------------


def test_upload_rejects_disallowed_content_type(
    client: TestClient, session: Session, auth_user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(documents_routes, "IngestionService", _StubIngestionService)
    collection = _create_collection(session, auth_user)

    response = client.post(
        f"/api/collections/{collection.id}/documents",
        files={"file": ("virus.exe", b"data", "application/x-msdownload")},
    )

    assert response.status_code == 400


def test_upload_rejects_oversized_file(
    client: TestClient, session: Session, auth_user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(documents_routes, "IngestionService", _StubIngestionService)
    _set_override(session, "uploads.max_upload_size_mb", 1)
    collection = _create_collection(session, auth_user)
    oversized = b"x" * (2 * 1024 * 1024)

    response = client.post(
        f"/api/collections/{collection.id}/documents",
        files={"file": ("big.txt", oversized, "text/plain")},
    )

    assert response.status_code == 413


def test_upload_allows_small_permitted_file(
    client: TestClient, session: Session, auth_user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(documents_routes, "IngestionService", _StubIngestionService)
    collection = _create_collection(session, auth_user)

    response = client.post(
        f"/api/collections/{collection.id}/documents",
        files={"file": ("doc.txt", b"hello world", "text/plain")},
    )

    assert response.status_code == 201
