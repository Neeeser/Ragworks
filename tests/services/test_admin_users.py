"""Behavior tests for AdminUserService: rollups and last-admin protection."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.schemas.admin import AdminUserUpdate
from app.schemas.enums import CollectionPurpose, UserRole
from app.services.admin_users import AdminUserService
from app.services.errors import InvalidInputError, NotFoundError


def _make_user(
    session: Session,
    email: str,
    role: UserRole = UserRole.USER,
    is_active: bool = True,
) -> models.User:
    user = models.User(
        email=email, hashed_password="hashed", role=role.value, is_active=is_active
    )
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


def test_counts_exclude_eval_collections_and_their_documents(session: Session) -> None:
    """An eval corpus is scaffolding, so it never counts as the user's storage.

    The Evals section provisions a real collection per (dataset, ingestion
    pipeline) and fills it with the benchmark corpus. `list_for_user` already
    hides those, so counting them here made the admin roster disagree with the
    user's own Collections page by the size of every eval they had run.
    """
    member = _make_user(session, "member@example.com")
    own = models.Collection(name="mine", user_id=member.id)
    benchmark = models.Collection(
        name="Eval: BEIR [abc123]",
        user_id=member.id,
        system_purpose=CollectionPurpose.EVAL.value,
    )
    session.add(own)
    session.add(benchmark)
    session.commit()
    session.refresh(own)
    session.refresh(benchmark)
    for collection, name in ((own, "real.txt"), (benchmark, "corpus-doc-001.txt")):
        session.add(
            models.Document(
                name=name,
                content_type="text/plain",
                embedding_model="text-embedding-3-small",
                user_id=member.id,
                collection_id=collection.id,
                status=models.DocumentStatus.READY,
            )
        )
    session.commit()

    row = next(r for r in AdminUserService(session).list_users() if r.id == member.id)

    assert row.collection_count == 1
    assert row.document_count == 1


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


def test_last_admin_guard_counts_only_active_admins(session: Session) -> None:
    """Regression test: demoting/deactivating the only ACTIVE admin is rejected,
    even if inactive admins exist."""
    # Seed: one active admin (A), one inactive admin (B)
    active_admin = _make_user(session, "active@example.com", UserRole.ADMIN, is_active=True)
    _make_user(session, "inactive@example.com", UserRole.ADMIN, is_active=False)

    # Should reject demoting the active admin
    with pytest.raises(InvalidInputError):
        AdminUserService(session).update_user(
            active_admin.id, AdminUserUpdate(role=UserRole.USER)
        )

    # Should reject deactivating the active admin
    with pytest.raises(InvalidInputError):
        AdminUserService(session).update_user(active_admin.id, AdminUserUpdate(is_active=False))

    # Should allow demoting the already-inactive admin (does not reduce active count)
    inactive_admin = UserRepository(session).get_by_email("inactive@example.com")
    assert inactive_admin is not None
    AdminUserService(session).update_user(
        inactive_admin.id, AdminUserUpdate(role=UserRole.USER)
    )

    # Verify the inactive admin was demoted
    with Session(session.get_bind()) as fresh_session:
        demoted = fresh_session.get(models.User, inactive_admin.id)
        assert demoted is not None
        assert demoted.role == UserRole.USER.value
