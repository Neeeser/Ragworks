"""Admin user management: listing with rollups, role/active updates.

Owns the last-admin invariant: the system must always retain at least one
active admin, so demoting or deactivating the only remaining admin is rejected
as an InvalidInputError (400), including when an admin targets themselves.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository, DocumentRepository, UserRepository
from app.schemas.admin import AdminUserRead, AdminUserUpdate
from app.schemas.enums import UserRole
from app.services.errors import InvalidInputError, NotFoundError


class AdminUserService:
    """List and update user accounts on behalf of an administrator."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.users = UserRepository(session)

    def list_users(self) -> list[AdminUserRead]:
        """Return every account with role, status, and ownership rollups."""
        collection_counts = CollectionRepository(self.session).count_by_user()
        document_counts = DocumentRepository(self.session).count_by_user()
        return [
            AdminUserRead(
                id=user.id,
                email=user.email,
                full_name=user.full_name,
                role=UserRole(user.role),
                is_active=user.is_active,
                created_at=user.created_at,
                updated_at=user.updated_at,
                collection_count=collection_counts.get(user.id, 0),
                document_count=document_counts.get(user.id, 0),
            )
            for user in self.users.list_all()
        ]

    def update_user(self, user_id: UUID, payload: AdminUserUpdate) -> models.User:
        """Apply a sparse role/active update, protecting the last admin."""
        user = self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")

        demotes = payload.role is not None and payload.role != UserRole.ADMIN
        deactivates = payload.is_active is False
        if (
            (demotes or deactivates)
            and user.role == UserRole.ADMIN.value
            and self.users.count_admins() <= 1
        ):
            raise InvalidInputError("Cannot demote or deactivate the last remaining admin.")

        if payload.role is not None:
            user.role = payload.role.value
        if payload.is_active is not None:
            user.is_active = payload.is_active
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user
