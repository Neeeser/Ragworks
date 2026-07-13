"""Data access for per-user provider connections."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlmodel import col, select

from app.db.models import ProviderConnection
from app.db.repositories.base import Repository


class ProviderConnectionRepository(Repository):
    """Queries over the `provider_connections` table."""

    def list_for_user(self, user_id: UUID) -> list[ProviderConnection]:
        """Return the user's connections, oldest first (stable UI ordering)."""
        statement = (
            select(ProviderConnection)
            .where(col(ProviderConnection.user_id) == user_id)
            .order_by(col(ProviderConnection.created_at))
        )
        return list(self.session.exec(statement).all())

    def list_for_user_of_type(
        self, user_id: UUID, provider_type: str
    ) -> list[ProviderConnection]:
        """Return the user's connections of one provider type, oldest first."""
        statement = (
            select(ProviderConnection)
            .where(col(ProviderConnection.user_id) == user_id)
            .where(col(ProviderConnection.provider_type) == provider_type)
            .order_by(col(ProviderConnection.created_at))
        )
        return list(self.session.exec(statement).all())

    def get_owned(self, connection_id: UUID, user_id: UUID) -> ProviderConnection | None:
        """Return the connection when it exists and belongs to the user."""
        statement = (
            select(ProviderConnection)
            .where(col(ProviderConnection.id) == connection_id)
            .where(col(ProviderConnection.user_id) == user_id)
        )
        return self.session.exec(statement).first()

    def create(
        self,
        *,
        user_id: UUID,
        provider_type: str,
        label: str,
        config: dict[str, Any],
    ) -> ProviderConnection:
        """Persist a new connection and return it."""
        connection = ProviderConnection(
            user_id=user_id,
            provider_type=provider_type,
            label=label,
            config=config,
        )
        return self._add(connection)

    def delete(self, connection: ProviderConnection) -> None:
        """Delete a connection row."""
        self.session.delete(connection)
        self.session.flush()
