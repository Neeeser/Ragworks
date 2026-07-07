"""Admin-facing wire schemas: user management and runtime config."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr

from app.schemas.app_config import ConfigFieldKind
from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import UserRole


class AdminUserRead(DateTimeConfigMixin, BaseModel):
    """A user row as seen by administrators, with ownership rollups."""

    model_config = ConfigDict(**DateTimeConfigMixin.model_config, from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str | None = None
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime
    collection_count: int
    document_count: int


class AdminUserUpdate(BaseModel):
    """Sparse admin update for a user's role and active flag."""

    role: UserRole | None = None
    is_active: bool | None = None


class ConfigSource(StrEnum):
    """Where a config field's effective value came from."""

    DEFAULT = "default"
    OVERRIDE = "db"
    ENV = "env-locked"


class ConfigFieldRead(BaseModel):
    """A single config field's catalog metadata plus its resolved value."""

    key: str
    label: str
    description: str
    kind: ConfigFieldKind
    public: bool
    env_var: str | None
    value: Any
    default: Any
    source: ConfigSource


AppConfigUpdate = dict[str, dict[str, Any]]
"""Sparse nested PATCH body: `{section: {leaf: value_or_null}}`.

A plain type alias, not a `BaseModel` subclass -- the route body is typed
`AppConfigUpdate` directly (Pydantic validates the dict/nesting shape), and
`AppConfigService.apply_update` validates the semantics (unknown keys,
env-pinned keys, model-rejected values).
"""
