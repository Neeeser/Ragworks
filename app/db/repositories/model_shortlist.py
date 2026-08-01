"""Data access for per-user model shortlists."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlmodel import col, select

from app.db.models import ModelShortlistRow
from app.db.repositories.base import Repository
from app.schemas.enums import ProviderKind, ShortlistEntryType


class ModelShortlistRepository(Repository):
    """Queries over the `model_shortlist_entries` table."""

    def list_for_user(self, user_id: UUID, kind: ProviderKind) -> list[ModelShortlistRow]:
        """Return every shortlist entry a user holds for one model kind.

        Ordered newest-activity first (`last_used_at` on recents, falling back
        to `created_at` for pins, which have none) so both sections render in
        the order the user would expect without a second sort.
        """
        statement = (
            select(ModelShortlistRow)
            .where(col(ModelShortlistRow.user_id) == user_id)
            .where(col(ModelShortlistRow.kind) == kind)
            .order_by(
                col(ModelShortlistRow.last_used_at).desc().nullslast(),
                col(ModelShortlistRow.created_at).desc(),
            )
        )
        return list(self.session.exec(statement).all())

    def get(
        self,
        *,
        user_id: UUID,
        kind: ProviderKind,
        entry_type: ShortlistEntryType,
        connection_id: UUID,
        model_id: str,
    ) -> ModelShortlistRow | None:
        """Return one entry by its full identity, or None."""
        statement = (
            select(ModelShortlistRow)
            .where(col(ModelShortlistRow.user_id) == user_id)
            .where(col(ModelShortlistRow.kind) == kind)
            .where(col(ModelShortlistRow.entry_type) == entry_type)
            .where(col(ModelShortlistRow.connection_id) == connection_id)
            .where(col(ModelShortlistRow.model_id) == model_id)
        )
        return self.session.exec(statement).first()

    def create(
        self,
        *,
        user_id: UUID,
        kind: ProviderKind,
        entry_type: ShortlistEntryType,
        connection_id: UUID,
        model_id: str,
        last_used_at: datetime | None = None,
    ) -> ModelShortlistRow:
        """Persist a new entry and return it."""
        return self._add(
            ModelShortlistRow(
                user_id=user_id,
                kind=kind,
                entry_type=entry_type,
                connection_id=connection_id,
                model_id=model_id,
                last_used_at=last_used_at,
            )
        )

    def delete(self, entry: ModelShortlistRow) -> None:
        """Remove one entry."""
        self.session.delete(entry)
        self.session.flush()

    def list_of_type(
        self, user_id: UUID, kind: ProviderKind, entry_type: ShortlistEntryType
    ) -> list[ModelShortlistRow]:
        """Return one section of a user's shortlist, newest activity first."""
        statement = (
            select(ModelShortlistRow)
            .where(col(ModelShortlistRow.user_id) == user_id)
            .where(col(ModelShortlistRow.kind) == kind)
            .where(col(ModelShortlistRow.entry_type) == entry_type)
            .order_by(
                col(ModelShortlistRow.last_used_at).desc().nullslast(),
                col(ModelShortlistRow.created_at).desc(),
            )
        )
        return list(self.session.exec(statement).all())

    def delete_ids(self, entry_ids: list[UUID]) -> None:
        """Remove entries by id (used to prune recents past the cap)."""
        if not entry_ids:
            return
        statement = sa_delete(ModelShortlistRow).where(
            col(ModelShortlistRow.id).in_(entry_ids)
        )
        self.session.execute(statement)
        self.session.flush()
