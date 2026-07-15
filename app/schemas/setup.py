"""Wire types for the first-run setup surface (`/api/setup`)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.collections import CollectionRead
from app.schemas.enums import IndexBackend


class SetupStatusRead(BaseModel):
    """Derived first-run readiness: real state, never a stored flag."""

    has_embedding_provider: bool
    has_chat_provider: bool
    has_vector_store: bool
    has_index: bool
    has_collection: bool
    setup_complete: bool


class SetupBootstrapRequest(BaseModel):
    """The wizard's confirmed choices, applied in one transaction."""

    embedding_connection_id: UUID
    embedding_model: str = Field(min_length=1)
    embedding_dimension: int | None = Field(default=None, gt=0)
    backend: IndexBackend
    index_name: str = Field(min_length=1, max_length=45)
    collection_name: str = Field(min_length=1, max_length=200)
    chunk_size: int = Field(default=512, gt=0)
    chunk_overlap: int = Field(default=200, ge=0)


class SetupBootstrapResponse(BaseModel):
    """The first collection the wizard created, ready for uploads."""

    collection: CollectionRead
