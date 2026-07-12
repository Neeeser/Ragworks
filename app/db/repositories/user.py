"""Repository for user accounts."""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import func
from sqlalchemy import update as sa_update
from sqlalchemy.engine import CursorResult
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository
from app.schemas.enums import UserRole


class UserRepository(Repository):
    """Data access helpers for users."""

    def get_by_email(self, email: str) -> models.User | None:
        """Return a user by email if one exists."""
        statement = select(models.User).where(models.User.email == email)
        return self.session.exec(statement).first()

    def get(self, user_id: UUID) -> models.User | None:
        """Return a user by id if one exists."""
        return self.session.get(models.User, user_id)

    def list_all(self) -> list[models.User]:
        """Return every user (used by admin-style backfills)."""
        return list(self.session.exec(select(models.User)).all())

    def add(self, user: models.User) -> models.User:
        """Persist a new user and return it."""
        return self._add(user)

    def count(self) -> int:
        """Return the total number of user rows."""
        statement = select(func.count()).select_from(models.User)  # pylint: disable=not-callable
        return self.session.exec(statement).one()

    def count_admins(self) -> int:
        """Return how many users hold the admin role."""
        statement = (
            select(func.count())  # pylint: disable=not-callable
            .select_from(models.User)
            .where(models.User.role == UserRole.ADMIN.value)
        )
        return self.session.exec(statement).one()

    def count_active_admins(self) -> int:
        """Return how many active users hold the admin role."""
        statement = (
            select(func.count())  # pylint: disable=not-callable
            .select_from(models.User)
            .where(col(models.User.role) == UserRole.ADMIN.value)
            .where(col(models.User.is_active))
        )
        return self.session.exec(statement).one()

    def earliest_created(self) -> models.User | None:
        """Return the oldest account (first-registered) if any users exist."""
        statement = select(models.User).order_by(col(models.User.created_at).asc()).limit(1)
        return self.session.exec(statement).first()


class AuthSessionRepository(Repository):
    """Persistence helpers for revocable browser sessions."""

    def add(self, auth_session: models.AuthSession) -> models.AuthSession:
        return self._add(auth_session)

    def get_by_digest(self, digest: str) -> models.AuthSession | None:
        statement = select(models.AuthSession).where(models.AuthSession.token_digest == digest)
        return self.session.exec(statement).first()

    def get_by_previous_digest(self, digest: str) -> models.AuthSession | None:
        statement = select(models.AuthSession).where(
            models.AuthSession.previous_token_digest == digest
        )
        return self.session.exec(statement).first()

    def get_owned(self, session_id: UUID, user_id: UUID) -> models.AuthSession | None:
        statement = select(models.AuthSession).where(
            models.AuthSession.id == session_id, models.AuthSession.user_id == user_id
        )
        return self.session.exec(statement).first()

    def rotate_if_current(
        self,
        session_id: UUID,
        *,
        current_digest: str,
        rotated_digest: str,
        used_at: datetime,
    ) -> bool:
        """Atomically rotate a refresh digest if it is still current."""
        result = cast(
            CursorResult[Any],
            self.session.execute(
                sa_update(models.AuthSession)
                .where(
                    col(models.AuthSession.id) == session_id,
                    col(models.AuthSession.token_digest) == current_digest,
                    col(models.AuthSession.revoked_at).is_(None),
                )
                .values(
                    previous_token_digest=current_digest,
                    token_digest=rotated_digest,
                    last_used_at=used_at,
                )
            )
        )
        return result.rowcount == 1

    def list_active(self, user_id: UUID) -> list[models.AuthSession]:
        statement = select(models.AuthSession).where(
            models.AuthSession.user_id == user_id,
            col(models.AuthSession.revoked_at).is_(None),
        )
        return list(self.session.exec(statement).all())
