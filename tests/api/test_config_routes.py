"""HTTP contract for GET /api/config and the admin config catalog/PATCH routes.

Every test that touches an env-pin monkeypatches `os.environ` (via
`monkeypatch.setenv`) and must clear the `get_settings` cache both before and
after so the pin takes effect and never leaks into later tests. The autouse
`_invalidate_cache` fixture below resets `get_app_config`'s process cache
around each test for the same reason -- route tests hit the module cache, not
a fresh service per call.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import get_settings
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
    assert "models.default_chat_model" in keys
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


def test_patch_config_unknown_key_is_400(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)

    response = client.patch("/api/admin/config", json={"uploads": {"nope": 1}})

    assert response.status_code == 400
    assert "uploads.nope" in response.json()["detail"]


def test_patch_config_env_pinned_field_is_400(
    client: TestClient,
    session: Session,
    auth_user: models.User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _promote(session, auth_user)

    monkeypatch.setenv("OPENROUTER_DEFAULT_CHAT_MODEL", "env/model")
    get_settings.cache_clear()
    invalidate_app_config_cache()
    try:
        response = client.patch(
            "/api/admin/config",
            json={"models": {"default_chat_model": "new/model"}},
        )
        assert response.status_code == 400
        assert "models.default_chat_model" in response.json()["detail"]
    finally:
        get_settings.cache_clear()
        invalidate_app_config_cache()
