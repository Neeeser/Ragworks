"""Admin-facing wire schemas: user management."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr

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
