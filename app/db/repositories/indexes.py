"""Repository for registered vector indexes."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import asc
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository, user_scoped
from app.schemas.enums import IndexBackend


class RegisteredIndexRepository(Repository):
    """Data access helpers for a user's registered indexes."""

    def list_for_user(
        self,
        user_id: UUID,
        *,
        backend: IndexBackend | None = None,
    ) -> list[models.RegisteredIndex]:
        """List a user's registered indexes in stable name order."""
        statement = user_scoped(
            select(models.RegisteredIndex), models.RegisteredIndex, user_id
        )
        if backend is not None:
            statement = statement.where(col(models.RegisteredIndex.backend) == backend)
        statement = statement.order_by(
            asc(col(models.RegisteredIndex.backend)),
            asc(col(models.RegisteredIndex.name)),
        )
        return list(self.session.exec(statement).all())

    def get(self, index_id: UUID, user_id: UUID) -> models.RegisteredIndex | None:
        """Return one registered index the user owns, else None."""
        index = self.session.get(models.RegisteredIndex, index_id)
        if index is None or index.user_id != user_id:
            return None
        return index

    def find_by_identity(
        self,
        user_id: UUID,
        backend: IndexBackend,
        name: str,
    ) -> models.RegisteredIndex | None:
        """Return the row for `(user, backend, name)`, the identity triple."""
        statement = user_scoped(
            select(models.RegisteredIndex), models.RegisteredIndex, user_id
        ).where(
            col(models.RegisteredIndex.backend) == backend,
            col(models.RegisteredIndex.name) == name,
        )
        return self.session.exec(statement).first()

    def other_owner_exists(
        self,
        user_id: UUID,
        backend: IndexBackend,
        name: str,
    ) -> bool:
        """Whether a *different* user has registered `(backend, name)`.

        Deliberately not user-scoped: on a backend whose index names are
        shared workspace-wide, this is the only signal that a destructive
        operation would land on somebody else's data.
        """
        statement = select(models.RegisteredIndex).where(
            col(models.RegisteredIndex.backend) == backend,
            col(models.RegisteredIndex.name) == name,
            col(models.RegisteredIndex.user_id) != user_id,
        )
        return self.session.exec(statement).first() is not None

    def get_or_create(
        self,
        user_id: UUID,
        backend: IndexBackend,
        name: str,
        *,
        vector_type: str = "dense",
        dimension: int | None = None,
        metric: str | None = None,
    ) -> models.RegisteredIndex:
        """Return the existing row for the identity triple, or register one.

        Registration is idempotent because ingestion, the migration, and the
        Index Manager all reach the same index by name; a second row for one
        physical store would let two bindings disagree about it.
        """
        existing = self.find_by_identity(user_id, backend, name)
        if existing is not None:
            return existing
        return self._add(
            models.RegisteredIndex(
                user_id=user_id,
                backend=backend,
                name=name,
                vector_type=vector_type,
                dimension=dimension,
                metric=metric,
            )
        )

    def delete(self, index: models.RegisteredIndex) -> None:
        """Delete a registration row; the caller flushes/commits."""
        self.session.delete(index)
