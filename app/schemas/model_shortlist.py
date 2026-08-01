"""Wire types for a user's model shortlist (pinned models and recents).

A shortlist entry names a model the way every other persisted model choice
does -- as a `(connection_id, model_id)` pair, never a munged
`"provider:model"` string -- so the frontend joins entries against the live
catalog and an entry whose model has disappeared is visible as unavailable
rather than silently dropped.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.enums import ProviderKind, ShortlistEntryType

#: The kinds a model can be shortlisted for. `VECTOR_STORE` is a provider
#: capability, not a model kind, so a shortlist of them is unrepresentable
#: rather than merely refused.
SHORTLIST_KINDS = (ProviderKind.CHAT, ProviderKind.EMBEDDING, ProviderKind.RERANKING)


class ModelShortlistIdentity(BaseModel):
    """The model a shortlist request names, qualified by its connection."""

    kind: ProviderKind
    connection_id: UUID
    model_id: str = Field(min_length=1, max_length=200)

    @field_validator("kind")
    @classmethod
    def _model_kind_only(cls, value: ProviderKind) -> ProviderKind:
        """Reject kinds that name a provider capability rather than a model."""
        if value not in SHORTLIST_KINDS:
            allowed = ", ".join(kind.value for kind in SHORTLIST_KINDS)
            raise ValueError(f"kind must be one of: {allowed}")
        return value


class ModelShortlistEntry(BaseModel):
    """One shortlisted model, as served to the client."""

    model_config = ConfigDict(from_attributes=True)

    kind: ProviderKind
    entry_type: ShortlistEntryType
    connection_id: UUID
    model_id: str
    created_at: datetime
    last_used_at: datetime | None = None


class ModelShortlistResponse(BaseModel):
    """A user's shortlist for one model kind."""

    pinned: list[ModelShortlistEntry] = Field(default_factory=list)
    recent: list[ModelShortlistEntry] = Field(default_factory=list)
