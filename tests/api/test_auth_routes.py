"""HTTP-contract tests for the auth route module.

Registration, settings, and key-validation behavior moved to service-level tests
(``tests/services/test_accounts.py`` and ``tests/services/test_provider_keys.py``)
when Task 6.2 gutted the route. What remains here is the one behavior the route
itself owns end-to-end: password verification on token issue. The cross-cutting
401/422 contract lives in ``tests/api/test_route_contract.py``.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes import auth as auth_routes
from app.core.security import hash_password
from app.db import models
from app.db.repositories import TelemetryRepository


def test_login_for_access_token_rejects_invalid_password(session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password=hash_password("correct-password"),
    )
    session.add(user)
    session.commit()

    form_data = SimpleNamespace(username="user@example.com", password="wrong-password")

    with pytest.raises(HTTPException) as excinfo:
        auth_routes.login_for_access_token(form_data, session=session)

    assert excinfo.value.status_code == 401


def test_login_for_access_token_rejects_deactivated_account(
    unauthed_client: TestClient, session: Session
) -> None:
    """A deactivated account must not receive a token, even with the right password.

    Otherwise login appears to succeed and every subsequent call 401s via
    ``get_current_user`` -- confusing, not a security hole, but worth rejecting
    at login with the same indistinguishable-from-bad-credentials response.
    """
    user = models.User(
        email="deactivated@example.com",
        full_name="Deactivated User",
        hashed_password=hash_password("correct-password"),
        is_active=False,
    )
    session.add(user)
    session.commit()

    response = unauthed_client.post(
        "/api/auth/token",
        data={
            "grant_type": "password",
            "username": "deactivated@example.com",
            "password": "correct-password",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"


def test_login_records_a_user_signed_in_telemetry_event(
    unauthed_client: TestClient, session: Session
) -> None:
    """A successful credential exchange is recorded for the admin dashboards."""
    user = models.User(
        email="telemetry-login@example.com",
        hashed_password=hash_password("password123"),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    response = unauthed_client.post(
        "/api/auth/token",
        data={
            "grant_type": "password",
            "username": "telemetry-login@example.com",
            "password": "password123",
        },
    )

    assert response.status_code == 200
    with Session(session.get_bind()) as fresh:
        rows = TelemetryRepository(fresh).list_by_type("user.signed_in")
    assert [row.user_id for row in rows] == [user.id]


def test_validate_key_probe_requires_auth(unauthed_client) -> None:
    response = unauthed_client.post(
        "/api/auth/keys/validate",
        json={"provider": "openrouter", "api_key": "sk-or-x"},
    )
    assert response.status_code == 401


def test_validate_key_probe_checks_without_persisting(client, auth_user, session, monkeypatch) -> None:
    """The wizard probes a pasted key before save; the probe must not store it."""
    from app.schemas.auth import ProviderKeyStatus

    monkeypatch.setattr(
        "app.api.routes.auth.validate_key",
        lambda provider, api_key: ProviderKeyStatus(
            configured=True, valid=api_key == "sk-or-good", message=None
        ),
    )

    good = client.post(
        "/api/auth/keys/validate", json={"provider": "openrouter", "api_key": "sk-or-good"}
    )
    bad = client.post(
        "/api/auth/keys/validate", json={"provider": "openrouter", "api_key": "sk-or-bad"}
    )

    assert good.status_code == 200
    assert good.json()["valid"] is True
    assert bad.json()["valid"] is False
    session.refresh(auth_user)
    assert auth_user.openrouter_api_key == "openrouter-key"  # unchanged fixture key
