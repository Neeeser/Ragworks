"""Admin-facing wire schemas: user management and runtime config."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr

from app.schemas.app_config import ConfigFieldKind, ConfigFieldOption
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
    options: list[ConfigFieldOption] | None
    min_value: int | None
    max_value: int | None
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


class AdminUserUsage(DateTimeConfigMixin, BaseModel):
    """One user's chat usage over the requested window."""

    user_id: UUID
    email: EmailStr
    turns: int
    total_tokens: int
    cost: float
    last_active: datetime


class AdminUsageSummary(DateTimeConfigMixin, BaseModel):
    """Instance-wide usage headline plus per-user rows for one window."""

    window_days: int
    total_turns: int
    total_tokens: int
    total_cost: float
    active_users: int
    event_counts: dict[str, int]
    users: list[AdminUserUsage]


class AdminUsagePoint(DateTimeConfigMixin, BaseModel):
    """One day's chat usage across all users."""

    day: datetime
    turns: int
    total_tokens: int


class AdminUsageTimeseries(DateTimeConfigMixin, BaseModel):
    """Daily chat-usage points for one window, oldest first."""

    window_days: int
    points: list[AdminUsagePoint]
