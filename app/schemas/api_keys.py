"""API key wire types.

The secret appears in exactly one response shape (`ApiKeyCreated`) and never
again: `ApiKeyRead` carries only the non-secret display prefix, so a key
listing can never leak a usable credential.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.enums import ApiKeyCapability

#: Capability sets are small by design; the cap stops a pathological payload.
MAX_CAPABILITIES = len(ApiKeyCapability)


class ApiKeyRead(BaseModel):
    """One API key as the management UI sees it — never the secret."""

    id: UUID
    name: str
    prefix: str
    capabilities: list[ApiKeyCapability]
    collection_ids: list[UUID]
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None


class ApiKeyCreate(BaseModel):
    """Payload for issuing a key: what it may do, and which collections it reaches.

    `collection_ids` is always explicit — there is no "every collection" grant,
    so a key's reach cannot silently grow to cover collections created after it.
    """

    name: str = Field(min_length=1, max_length=100)
    capabilities: list[ApiKeyCapability] = Field(min_length=1, max_length=MAX_CAPABILITIES)
    collection_ids: list[UUID] = Field(min_length=1, max_length=200)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)

    @field_validator("capabilities")
    @classmethod
    def _unique_capabilities(cls, value: list[ApiKeyCapability]) -> list[ApiKeyCapability]:
        """Reject duplicate capabilities rather than silently collapsing them."""
        if len(set(value)) != len(value):
            raise ValueError("Capabilities must be unique.")
        return value


class ApiKeyCreated(BaseModel):
    """The one response that carries the plaintext secret."""

    key: ApiKeyRead
    secret: str


class ApiKeyList(BaseModel):
    """A user's API keys."""

    keys: list[ApiKeyRead]
