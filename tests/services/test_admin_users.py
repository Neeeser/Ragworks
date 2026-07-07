"""Behavior tests for AdminUserService: rollups and last-admin protection."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.schemas.admin import AdminUserUpdate
from app.schemas.enums import UserRole
from app.services.admin_users import AdminUserService
from app.services.errors import InvalidInputError, NotFoundError


def _make_user(session: Session, email: str, role: UserRole = UserRole.USER) -> models.User:
    user = models.User(email=email, hashed_password="hashed", role=role.value)
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def test_list_users_includes_roles_and_counts(session: Session) -> None:
    _make_user(session, "admin@example.com", UserRole.ADMIN)
    member = _make_user(session, "member@example.com")
    session.add(models.Collection(name="c1", user_id=member.id))
    session.commit()

    rows = AdminUserService(session).list_users()

    by_email = {row.email: row for row in rows}
    assert by_email["admin@example.com"].role == UserRole.ADMIN
    assert by_email["member@example.com"].collection_count == 1
    assert by_email["admin@example.com"].collection_count == 0


def test_update_user_changes_role_and_active_flag(session: Session) -> None:
    _make_user(session, "admin@example.com", UserRole.ADMIN)
    member = _make_user(session, "member@example.com")

    AdminUserService(session).update_user(
        member.id, AdminUserUpdate(role=UserRole.ADMIN, is_active=False)
    )

    with Session(session.get_bind()) as fresh_session:
        fresh = fresh_session.get(models.User, member.id)
        assert fresh is not None
        assert fresh.role == UserRole.ADMIN.value
        assert fresh.is_active is False


def test_demoting_the_last_admin_is_rejected(session: Session) -> None:
    admin = _make_user(session, "admin@example.com", UserRole.ADMIN)

    with pytest.raises(InvalidInputError):
        AdminUserService(session).update_user(admin.id, AdminUserUpdate(role=UserRole.USER))
    with pytest.raises(InvalidInputError):
        AdminUserService(session).update_user(admin.id, AdminUserUpdate(is_active=False))


def test_update_missing_user_raises_not_found(session: Session) -> None:
    _make_user(session, "admin@example.com", UserRole.ADMIN)
    with pytest.raises(NotFoundError):
        AdminUserService(session).update_user(uuid4(), AdminUserUpdate(role=UserRole.ADMIN))
