"""Repository for runtime config overrides (`app_settings`)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlmodel import select

from app.db import models
from app.db.repositories.base import Repository


class AppSettingRepository(Repository):
    """Data access helpers for sparse runtime-config overrides."""

    def all_overrides(self) -> dict[str, Any]:
        """Return every overridden config key mapped to its stored value."""
        rows = self.session.exec(select(models.AppSetting)).all()
        return {row.key: row.value for row in rows}

    def upsert(self, key: str, value: Any, updated_by: UUID | None) -> models.AppSetting:
        """Create or update the override for `key`, returning the row."""
        existing = self.session.get(models.AppSetting, key)
        if existing is None:
            return self._add(models.AppSetting(key=key, value=value, updated_by=updated_by))
        existing.value = value
        existing.updated_by = updated_by
        return self._add(existing)

    def delete(self, key: str) -> None:
        """Remove the override for `key`, if one exists (no-op otherwise)."""
        existing = self.session.get(models.AppSetting, key)
        if existing is not None:
            self.session.delete(existing)
            self.session.flush()
