"""Collection and prompt schema models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.prompts import PromptTemplateRead, PromptTemplateUpdate


class CollectionBase(BaseModel):
    """Shared fields for collection payloads."""

    name: str
    description: Optional[str] = None
    ingestion_pipeline_id: Optional[UUID] = None
    retrieval_pipeline_id: Optional[UUID] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PipelineNodeOverride(BaseModel):
    """Override configuration for a specific pipeline node."""

    node_id: str
    config: Dict[str, Any] = Field(default_factory=dict)


class CollectionPipelineOverrides(BaseModel):
    """Per-collection pipeline overrides for creation."""

    ingestion: List[PipelineNodeOverride] = Field(default_factory=list)
    retrieval: List[PipelineNodeOverride] = Field(default_factory=list)


class CollectionCreate(CollectionBase):
    """Payload for creating a collection."""

    pipeline_overrides: Optional[CollectionPipelineOverrides] = None


class CollectionUpdate(BaseModel):
    """Payload for updating collection fields."""

    name: Optional[str] = None
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    ingestion_pipeline_id: Optional[UUID] = None
    retrieval_pipeline_id: Optional[UUID] = None


class CollectionRead(DateTimeConfigMixin, CollectionBase):
    """Collection details returned to clients."""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime


class CollectionDeleteResponse(BaseModel):
    """Response payload for collection deletion."""

    status: str = "deleted"


class CollectionPromptRead(PromptTemplateRead):
    """Prompt template data returned to clients."""


class CollectionPromptUpdate(PromptTemplateUpdate):
    """Payload for updating a collection prompt."""


class CollectionStatsRead(BaseModel):
    """Aggregate stats for a collection."""

    collection_id: UUID
    document_count: int
    chunk_count: int
    average_latency_ms: Optional[float] = None
    last_used_at: Optional[datetime] = None
