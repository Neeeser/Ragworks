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
    openrouter_configured: bool
    pinecone_configured: bool
    last_used_chat_model: str | None = None
    last_used_parameters: dict[str, Any] | None = None
    last_used_provider: dict[str, Any] | None = None
    last_used_stream: bool | None = None
    last_used_tool_collection_ids: list[UUID] | None = None
    run_settings_order: list[RunSettingsSection] | None = None
    created_at: datetime
    updated_at: datetime


class UserSettingsUpdate(BaseModel):
    """Payload for updating user settings."""

    openrouter_api_key: str | None = None
    pinecone_api_key: str | None = None
    run_settings_order: list[RunSettingsSection] | None = None

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


class ProviderKeyStatus(BaseModel):
    """Validation status for a provider API key."""

    configured: bool
    valid: bool
    message: str | None = None


class ProviderKeyValidateRequest(BaseModel):
    """A pasted (not yet saved) provider key to probe."""

    provider: Literal["openrouter", "pinecone"]
    api_key: str = Field(min_length=1)


class UserKeyValidation(BaseModel):
    """Validation results for user API keys."""

    openrouter: ProviderKeyStatus
    pinecone: ProviderKeyStatus


class Token(BaseModel):
    """JWT token response."""

    access_token: str
    token_type: str = "bearer"
