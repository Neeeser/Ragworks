"""HTTP contract for GET /api/config and the admin config catalog/PATCH routes.

The autouse `_invalidate_cache` fixture below resets `get_app_config`'s
process cache around each test -- route tests hit the module cache, not a
fresh service per call. Env-pinned-field rejection is exercised at the
service layer (`tests/services/test_app_config_service.py`), not here: no
current field carries an `env_var`, so simulating one needs `iter_config_fields`
patched, which belongs next to `AppConfigService.apply_update`.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.services.app_config import invalidate_app_config_cache


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Ensure `get_app_config`'s process-wide cache never leaks across tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _promote(session: Session, user: models.User) -> None:
    user.role = "admin"
    session.add(user)
    session.commit()
    session.refresh(user)


def test_public_config_returns_exact_public_shape(unauthed_client: TestClient) -> None:
    response = unauthed_client.get("/api/config")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "auth": {"allow_registration": True},
        "uploads": {
            "max_upload_size_mb": 50,
            "allowed_content_types": [
                "text/plain",
                "text/markdown",
                "text/csv",
                "application/pdf",
            ],
        },
        "indexing": {"default_backend": "pgvector"},
        "features": {"umap_visualizations": True, "chat_branching": True},
    }
    assert "models" not in body


def test_admin_config_requires_token(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/admin/config").status_code == 401


def test_admin_config_rejects_non_admin(client: TestClient) -> None:
    assert client.get("/api/admin/config").status_code == 403


def test_admin_config_lists_full_catalog(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)

    response = client.get("/api/admin/config")

    assert response.status_code == 200
    body = response.json()
    assert len(body) > 0
    keys = {entry["key"] for entry in body}
    assert "auth.allow_registration" in keys
    assert "uploads.max_upload_size_mb" in keys
    for entry in body:
        for field in ("key", "label", "kind", "value", "default", "source"):
            assert field in entry


def test_patch_config_round_trips_through_public_get(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """Verify a PATCH is visible immediately through the public endpoint.

    The config cache is invalidated on update, not left to the TTL: a warm
    cache lookup after PATCH proves the invalidation call happened and took
    effect, not that we got lucky with a cold cache read.
    """
    _promote(session, auth_user)

    # Warm the cache with the pre-PATCH value.
    pre_patch = client.get("/api/config").json()
    assert pre_patch["auth"]["allow_registration"] is True

    response = client.patch(
        "/api/admin/config", json={"auth": {"allow_registration": False}}
    )
    assert response.status_code == 200
    updated = {entry["key"]: entry for entry in response.json()}
    assert updated["auth.allow_registration"]["value"] is False

    # Post-PATCH GET hits the warm cache and only passes if invalidation
    # cleared it and forced a fresh read from the DB.
    public = client.get("/api/config").json()
    assert public["auth"]["allow_registration"] is False


def test_admin_config_catalog_exposes_options_and_numeric_bounds(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """The catalog must carry the same constraints `AppConfig` enforces, or
    the admin UI renders a free-text control for a field with a finite
    domain (issue #76)."""
    _promote(session, auth_user)

    body = {entry["key"]: entry for entry in client.get("/api/admin/config").json()}

    content_types = body["uploads.allowed_content_types"]
    assert content_types["kind"] == "multi_select"
    assert {option["value"] for option in content_types["options"]} == {
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/pdf",
    }

    backend = body["indexing.default_backend"]
    assert backend["kind"] == "select"
    assert {option["value"] for option in backend["options"]} == {"pgvector", "pinecone"}

    upload_size = body["uploads.max_upload_size_mb"]
    assert (upload_size["min_value"], upload_size["max_value"]) == (1, 1024)


def test_patch_config_rejects_unknown_content_type(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """A crafted PATCH bypassing the UI must not persist an unsupported MIME
    type -- the frontend constrains input, the backend is the boundary."""
    _promote(session, auth_user)

    response = client.patch(
        "/api/admin/config",
        json={"uploads": {"allowed_content_types": ["application/x-not-a-real-type"]}},
    )

    assert response.status_code == 400
    assert "uploads.allowed_content_types" in response.json()["detail"]


def test_patch_config_rejects_unregistered_backend(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)

    response = client.patch(
        "/api/admin/config", json={"indexing": {"default_backend": "not-a-backend"}}
    )

    assert response.status_code == 400
    assert "indexing.default_backend" in response.json()["detail"]


def test_patch_config_unknown_key_is_400(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)

    response = client.patch("/api/admin/config", json={"uploads": {"nope": 1}})

    assert response.status_code == 400
    assert "uploads.nope" in response.json()["detail"]
