"""HTTP contract for /api/admin/users: auth gating, role gating, update flows."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.schemas.enums import UserRole


def _promote(session: Session, user: models.User) -> None:
    user.role = UserRole.ADMIN.value
    session.add(user)
    session.commit()
    session.refresh(user)


def _add_user(session: Session, email: str, role: UserRole = UserRole.USER) -> models.User:
    user = models.User(email=email, hashed_password="hashed", role=role.value)
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def test_admin_users_requires_token(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/admin/users").status_code == 401


def test_admin_users_rejects_non_admin(client: TestClient) -> None:
    assert client.get("/api/admin/users").status_code == 403


def test_admin_lists_users_with_roles(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)
    _add_user(session, "member@example.com")

    response = client.get("/api/admin/users")

    assert response.status_code == 200
    body = response.json()
    assert {entry["email"] for entry in body} == {auth_user.email, "member@example.com"}
    roles = {entry["email"]: entry["role"] for entry in body}
    assert roles[auth_user.email] == "admin"
    assert "hashed_password" not in body[0]


def test_admin_promotes_and_deactivates_a_member(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)
    member = _add_user(session, "member@example.com")

    response = client.patch(f"/api/admin/users/{member.id}", json={"role": "admin"})
    assert response.status_code == 200
    assert response.json()["role"] == "admin"

    response = client.patch(f"/api/admin/users/{member.id}", json={"is_active": False})
    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_demoting_last_admin_is_a_400(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)
    response = client.patch(f"/api/admin/users/{auth_user.id}", json={"role": "user"})
    assert response.status_code == 400


def test_updating_missing_user_is_a_404(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _promote(session, auth_user)
    response = client.patch(f"/api/admin/users/{uuid4()}", json={"role": "admin"})
    assert response.status_code == 404
