"""Pipeline schema models."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from app.db.models import PipelineKind
from app.pipelines.models import PipelineDefinition
from app.pipelines.runtime import NodeSpec, PipelineValidationResult
from app.schemas.base import DateTimeConfigMixin


class PipelineCreate(BaseModel):
    """Payload for creating a pipeline."""

    name: str
    kind: PipelineKind
    definition: PipelineDefinition
    description: Optional[str] = None
    change_summary: Optional[str] = None


class PipelineUpdate(BaseModel):
    """Payload for updating a pipeline."""

    name: Optional[str] = None
    description: Optional[str] = None
    definition: Optional[PipelineDefinition] = None
    change_summary: Optional[str] = None


class PipelineRead(DateTimeConfigMixin, BaseModel):
    """Pipeline details returned to clients."""

    id: UUID
    user_id: UUID
    name: str
    description: Optional[str]
    kind: PipelineKind
    current_version: int
    is_default: bool
    created_at: datetime
    updated_at: datetime
    definition: PipelineDefinition


class PipelineVersionRead(DateTimeConfigMixin, BaseModel):
    """Pipeline version details returned to clients."""

    id: UUID
    pipeline_id: UUID
    version: int
    created_at: datetime
    updated_at: datetime
    change_summary: Optional[str]
    created_by: Optional[UUID]


class PipelineNodesResponse(BaseModel):
    """Response payload for node catalog requests."""

    nodes: List[NodeSpec]


class PipelineValidationResponse(PipelineValidationResult):
    """Response payload for pipeline validation."""


class PipelineActivateRequest(BaseModel):
    """Payload to activate a pipeline version."""

    version: int


class PipelineDeleteResponse(BaseModel):
    """Response payload for pipeline deletion."""

    status: str = "deleted"
