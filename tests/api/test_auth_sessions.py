"""Persistent authentication-session contract tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.security import hash_password
from app.db import models
from app.db.repositories import AuthSessionRepository
from app.utils.time import utc_now


def _login(client: TestClient, email: str, *, remember: bool = True):
    return client.post(
        "/api/auth/token",
        data={
            "grant_type": "password",
            "username": email,
            "password": "password123",
            "remember_me": str(remember).lower(),
        },
    )


def test_remembered_login_sets_rotating_refresh_cookie(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="remember@example.com",
        hashed_password=hash_password("password123"),
        remember_session_days=90,
    )
    session.add(user)
    session.commit()

    login = _login(unauthed_client, user.email)

    assert login.status_code == 200
    cookie = login.headers["set-cookie"]
    assert "ragworks_refresh=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Max-Age=7776000" in cookie
    first_cookie = unauthed_client.cookies["ragworks_refresh"]

    refreshed = unauthed_client.post("/api/auth/refresh")

    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]
    assert unauthed_client.cookies["ragworks_refresh"] != first_cookie


def test_non_remembered_login_uses_browser_session_cookie(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="session@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()

    response = _login(unauthed_client, user.email, remember=False)

    assert response.status_code == 200
    assert "Max-Age" not in response.headers["set-cookie"]


def test_logout_revokes_refresh_session(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="logout@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    _login(unauthed_client, user.email)

    response = unauthed_client.post("/api/auth/logout")

    assert response.status_code == 204
    assert unauthed_client.post("/api/auth/refresh").status_code == 401
    rows = session.exec(select(models.AuthSession)).all()
    assert len(rows) == 1
    assert rows[0].revoked_at is not None


def test_user_can_list_and_revoke_sessions(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="devices@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    login = _login(unauthed_client, user.email)
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    listed = unauthed_client.get("/api/auth/sessions", headers=headers)

    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["current"] is True
    session_id = listed.json()[0]["id"]

    revoked = unauthed_client.delete(f"/api/auth/sessions/{session_id}", headers=headers)

    assert revoked.status_code == 204
    assert unauthed_client.post("/api/auth/refresh").status_code == 401


def test_expired_refresh_session_is_rejected(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="expired@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    _login(unauthed_client, user.email)
    row = session.exec(select(models.AuthSession)).one()
    row.expires_at = datetime(2000, 1, 1, tzinfo=UTC)
    session.add(row)
    session.commit()

    assert unauthed_client.post("/api/auth/refresh").status_code == 401


def test_user_can_revoke_all_sessions(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="everywhere@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    login = _login(unauthed_client, user.email)
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = unauthed_client.delete("/api/auth/sessions", headers=headers)

    assert response.status_code == 204
    assert unauthed_client.post("/api/auth/refresh").status_code == 401
    assert all(row.revoked_at for row in session.exec(select(models.AuthSession)).all())


def test_revocation_immediately_invalidates_issued_access_token(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="access-revoke@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    login = _login(unauthed_client, user.email)
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    session_id = unauthed_client.get("/api/auth/sessions", headers=headers).json()[0]["id"]

    assert unauthed_client.delete(
        f"/api/auth/sessions/{session_id}", headers=headers
    ).status_code == 204
    assert unauthed_client.get("/api/auth/me", headers=headers).status_code == 401


def test_concurrent_refresh_reuses_the_same_rotation_result(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="concurrent@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    _login(unauthed_client, user.email)
    old_token = unauthed_client.cookies["ragworks_refresh"]

    first = unauthed_client.post("/api/auth/refresh")
    rotated_token = unauthed_client.cookies["ragworks_refresh"]
    row = session.exec(select(models.AuthSession)).one()
    assert row.previous_token_digest is not None
    assert row.revoked_at is None
    assert datetime.now(UTC) - row.last_used_at < timedelta(seconds=30)
    unauthed_client.cookies.clear()
    unauthed_client.cookies.set(
        "ragworks_refresh", old_token, domain="testserver.local", path="/api/auth"
    )
    second = unauthed_client.post("/api/auth/refresh")

    assert first.status_code == 200
    assert second.status_code == 200
    assert unauthed_client.cookies["ragworks_refresh"] == rotated_token


def test_only_one_refresh_rotation_can_claim_the_current_digest(
    session: Session,
) -> None:
    user = models.User(
        email="atomic-rotation@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    auth_session = AuthSessionRepository(session).add(
        models.AuthSession(
            user_id=user.id,
            token_digest="current-digest",
            persistent=True,
            expires_at=utc_now() + timedelta(days=30),
        )
    )
    session.commit()

    first_claimed = AuthSessionRepository(session).rotate_if_current(
        auth_session.id,
        current_digest="current-digest",
        rotated_digest="first-rotation",
        used_at=utc_now(),
    )
    session.commit()
    second_claimed = AuthSessionRepository(session).rotate_if_current(
        auth_session.id,
        current_digest="current-digest",
        rotated_digest="second-rotation",
        used_at=utc_now(),
    )

    assert first_claimed is True
    assert second_claimed is False
    session.refresh(auth_session)
    assert auth_session.token_digest == "first-rotation"


def test_stale_rotated_token_reuse_revokes_session(
    unauthed_client: TestClient, session: Session
) -> None:
    user = models.User(
        email="replay@example.com", hashed_password=hash_password("password123")
    )
    session.add(user)
    session.commit()
    _login(unauthed_client, user.email)
    old_token = unauthed_client.cookies["ragworks_refresh"]
    unauthed_client.post("/api/auth/refresh")
    row = session.exec(select(models.AuthSession)).one()
    row.last_used_at -= timedelta(minutes=2)
    session.add(row)
    session.commit()
    unauthed_client.cookies.clear()
    unauthed_client.cookies.set(
        "ragworks_refresh", old_token, domain="testserver.local", path="/api/auth"
    )
    replay = unauthed_client.post("/api/auth/refresh")

    assert replay.status_code == 401
    session.refresh(row)
    assert row.revoked_at is not None
