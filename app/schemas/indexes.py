"""Schemas for the backend-aware index management API (`/api/indexes`)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.schemas.enums import IndexBackend


class IndexRead(BaseModel):
    """Serialized vector-index metadata, tagged with its backend."""

    name: str
    backend: IndexBackend
    vector_type: str | None = None
    metric: str | None = None
    dimension: int | None = None
    status: dict[str, Any] | None = None
    host: str | None = None
    spec: dict[str, Any] | None = None
    deletion_protection: str | None = None
    tags: dict[str, str] | None = None


class IndexList(BaseModel):
    """List response for vector indexes."""

    indexes: list[IndexRead] = Field(default_factory=list)


class IndexCreateRequest(BaseModel):
    """Payload for creating a vector index on a chosen backend.

    `cloud`/`region`/`deletion_protection`/`tags` and `vector_type="sparse"`
    are Pinecone-only; capability validation in `IndexAdminService.create`
    rejects unsupported combinations with the backend's declared limits.
    """

    backend: IndexBackend
    name: str = Field(min_length=1, max_length=45)
    vector_type: str = Field(default="dense")
    dimension: int | None = Field(default=None, gt=0)
    metric: str = Field(default="cosine")
    cloud: str | None = None
    region: str | None = None
    deletion_protection: str | None = None
    tags: dict[str, str] | None = None

    @model_validator(mode="after")
    def validate_dimension(self) -> IndexCreateRequest:
        """Ensure dense indexes define a dimension and sparse indexes do not."""
        if self.vector_type == "dense" and self.dimension is None:
            raise ValueError("Dense indexes require a dimension.")
        if self.vector_type == "sparse" and self.dimension is not None:
            raise ValueError("Sparse indexes must not define a dimension.")
        return self


class IndexDeleteResponse(BaseModel):
    """Response after deleting a vector index."""

    status: str = "deleted"


class BackendCapabilitiesRead(BaseModel):
    """A backend's limits, served so the UI clamps inputs from live data."""

    max_dimension: int
    supported_metrics: list[str]
    supported_vector_types: list[str]
    index_name_max_length: int
    max_upsert_batch: int
    max_top_k: int
    requires_api_key: bool


class BackendInfoRead(BaseModel):
    """One vector-store backend's usability for the current user."""

    backend: IndexBackend
    label: str
    available: bool
    configured: bool
    capabilities: BackendCapabilitiesRead


class BackendInfoList(BaseModel):
    """List response for `GET /api/indexes/backends`."""

    backends: list[BackendInfoRead] = Field(default_factory=list)
