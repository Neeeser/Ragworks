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
