"""Retrieval request and response schema models."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, JsonValue


class RetrievedChunk(BaseModel):
    """Chunk returned from a retrieval query."""

    chunk_id: str
    document_id: str
    score: float
    text: str
    metadata: dict[str, Any]


class FailedNodeRef(BaseModel):
    """Identifies the pipeline node that failed a retrieval run."""

    node_id: str
    node_name: str
    node_type: str


class RetrievalFailureDetail(BaseModel):
    """Structured error body for a failed retrieval query.

    Returned as the HTTP error `detail` so the Search page can name the failed
    node and link to the run trace instead of dumping the raw provider error.
    `message` is the readable explanation; the raw provider text lives in the
    trace, not here.
    """

    message: str
    code: str
    failed_node: FailedNodeRef | None = None
    pipeline_run_id: UUID | None = None


class CollectionQueryRequest(BaseModel):
    """Payload for querying a collection.

    `arguments` supplies values for the pipeline's declared input arguments
    (see `GET /api/collections/{id}/query-arguments`); `top_k` is the legacy
    depth field — when the pipeline declares a `top_k` argument the legacy
    value feeds it, so old clients keep working.
    """

    query: str
    top_k: int = Field(default=5, ge=1)
    arguments: dict[str, JsonValue] | None = None


class CollectionQueryResponse(BaseModel):
    """Response payload for collection queries.

    `outputs` carries the pipeline's declared output expressions, evaluated
    for this run; empty when the pipeline declares none. Values are JSON-safe
    scalars, or lists of facet-bucket dicts when the primary tool is a
    structured facet pipeline (this endpoint delegates to the primary tool).
    """

    query: str
    top_k: int
    chunks: list[RetrievedChunk]
    usage: dict[str, Any]
    outputs: dict[str, Any] = Field(default_factory=dict)
    query_event_id: UUID | None = None
    pipeline_run_id: UUID | None = None


class QueryArgumentRead(BaseModel):
    """One declared input argument of a collection's retrieval pipeline.

    Mirrors the engine's `PipelineInputArgument` declaration shape; the
    search page renders one typed control per entry.
    """

    name: str
    type: str
    description: str = ""
    required: bool = False
    default: int | float | str | bool | None = None
    minimum: float | None = None
    maximum: float | None = None
    choices: list[str] = Field(default_factory=list)
    expose_to_llm: bool = False


class CollectionQueryArgumentsResponse(BaseModel):
    """Declared query arguments for a collection's retrieval pipeline.

    An empty list means the pipeline declares nothing — clients render the
    legacy built-in top_k control and send the legacy `top_k` field.
    """

    arguments: list[QueryArgumentRead] = Field(default_factory=list)
