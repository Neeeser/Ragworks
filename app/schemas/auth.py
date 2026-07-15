"""Authentication-related schema models."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import UserRole


class UserBase(DateTimeConfigMixin, BaseModel):
    """Shared fields for user payloads."""

    model_config = ConfigDict(**DateTimeConfigMixin.model_config, from_attributes=True)

    email: EmailStr
    full_name: str | None = None


class RunSettingsSection(str, Enum):
    """Sortable section identifiers for the run settings panel."""

    SYSTEM_PROMPT = "systemPrompt"
    COLLECTION_TOOLS = "collectionTools"
    STREAMING = "streaming"
    MODEL_ROUTING = "modelRouting"
    PROVIDER_ROUTING = "providerRouting"
    MODEL_PARAMETERS = "modelParameters"
    VITALS = "vitals"
    USAGE = "usage"


class UserCreate(UserBase):
    """Payload for creating a user."""

    password: str = Field(min_length=8)


class UserRead(UserBase):
    """User data returned to clients."""

    id: UUID
    is_active: bool
    role: UserRole
    last_used_chat_model: str | None = None
    last_used_chat_connection_id: UUID | None = None
    last_used_parameters: dict[str, Any] | None = None
    last_used_provider: dict[str, Any] | None = None
    last_used_stream: bool | None = None
    last_used_tool_collection_ids: list[UUID] | None = None
    run_settings_order: list[RunSettingsSection] | None = None
    remember_session_days: Literal[30, 90, 180] = 30
    created_at: datetime
    updated_at: datetime


class UserSettingsUpdate(BaseModel):
    """Payload for updating user settings."""

    run_settings_order: list[RunSettingsSection] | None = None
    remember_session_days: Literal[30, 90, 180] | None = None

    @field_validator("run_settings_order")
    @classmethod
    def ensure_unique_run_settings_order(
        cls, value: list[RunSettingsSection] | None
    ) -> list[RunSettingsSection] | None:
        """Reject run settings orders with duplicate entries."""
        if value is None:
            return value
        if len(set(value)) != len(value):
            raise ValueError("Run settings order must be unique.")
        return value


class Token(BaseModel):
    """JWT token response."""

    access_token: str
    token_type: str = "bearer"


class AuthSessionRead(BaseModel):
    """Safe browser-session metadata."""

    id: UUID
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    current: bool
