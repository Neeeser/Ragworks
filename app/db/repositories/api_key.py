"""Repository for scoped API keys."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import update as sa_update
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository


class ApiKeyRepository(Repository):
    """Data access helpers for API keys."""

    def add(self, api_key: models.ApiKey) -> models.ApiKey:
        """Persist a new key row and return it."""
        return self._add(api_key)

    def get_by_digest(self, digest: str) -> models.ApiKey | None:
        """Return the key matching a secret's digest, revoked or not.

        Revocation and expiry are decided by the caller (the service) so the
        rejection reason can be logged distinctly from "no such key".
        """
        statement = select(models.ApiKey).where(models.ApiKey.token_digest == digest)
        return self.session.exec(statement).first()

    def get_owned(self, key_id: UUID, user_id: UUID) -> models.ApiKey | None:
        """Return a user-owned key by id (cross-user reads look like 404s)."""
        statement = select(models.ApiKey).where(
            models.ApiKey.id == key_id, models.ApiKey.user_id == user_id
        )
        return self.session.exec(statement).first()

    def list_for_user(self, user_id: UUID) -> list[models.ApiKey]:
        """Return a user's keys, newest first (revoked ones included)."""
        statement = (
            select(models.ApiKey)
            .where(models.ApiKey.user_id == user_id)
            .order_by(col(models.ApiKey.created_at).desc())
        )
        return list(self.session.exec(statement).all())

    def touch_last_used(self, key_id: UUID, used_at: datetime) -> None:
        """Record a key's last use with a bare UPDATE.

        Written as a statement rather than a loaded-row mutation so recording
        the touch never depends on the caller's session state — MCP requests
        commit this even when the tool call itself fails.
        """
        self.session.execute(
            sa_update(models.ApiKey)
            .where(col(models.ApiKey.id) == key_id)
            .values(last_used_at=used_at)
        )

    def revoke(self, api_key: models.ApiKey, revoked_at: datetime) -> models.ApiKey:
        """Mark a key revoked; the row is kept as an audit record."""
        api_key.revoked_at = revoked_at
        self.session.add(api_key)
        self.session.flush()
        return api_key
