"""Collection and prompt schema models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin


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


class PromptVariable(BaseModel):
    """Template variable used in prompts."""

    name: str
    description: str
    example: Optional[str] = None


class CollectionPromptRead(BaseModel):
    """Prompt template data returned to clients."""

    template: str
    rendered: str
    context: Dict[str, str]
    variables: List[PromptVariable]
    is_custom: bool = False


class CollectionPromptUpdate(BaseModel):
    """Payload for updating a collection prompt."""

    template: Optional[str] = None
