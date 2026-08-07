"""Retrieval request and response schema models."""

from __future__ import annotations

from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, Field, JsonValue, model_validator

from app.schemas.media import MediaAssetRef, QueryMediaPayload
from app.schemas.provider_errors import ProviderErrorDetail


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
    #: Set when the run failed at a provider call, so the Search page can offer
    #: the action the code implies (add credit, fix the key) instead of only
    #: linking to the trace.
    provider_error: ProviderErrorDetail | None = None


class QueryRequestBase(BaseModel):
    """What every query surface asks with: text, an image, or both.

    Both endpoints that run a pipeline for a caller (the collection query
    endpoint and the tool-invoke endpoint) take the same pair, and the rule
    that a request must ask *something* lives here so the two cannot drift
    into disagreeing about what an empty body means.
    """

    query: str
    #: One image posted with the query. An image-only query sends an empty
    #: `query`; the pipeline's own modality analysis decides whether the
    #: graph can read it.
    query_media: QueryMediaPayload | None = None

    @model_validator(mode="after")
    def validate_request_asks_something(self) -> Self:
        """Reject a request carrying neither query text nor an image."""
        if not self.query.strip() and self.query_media is None:
            raise ValueError("A query must carry text, an image, or both.")
        return self


class CollectionQueryRequest(QueryRequestBase):
    """Payload for querying a collection.

    `arguments` supplies values for the pipeline's declared input arguments
    (see `GET /api/collections/{id}/query-arguments`); `top_k` is the legacy
    depth field — when the pipeline declares a `top_k` argument the legacy
    value feeds it, so old clients keep working.
    """

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
    #: The stored image this query was asked with, so the result panel can
    #: render what was submitted; absent for a text-only query.
    query_media: MediaAssetRef | None = None
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
    #: Whether the resolved pipeline can process an image query. False means
    #: sending `query_media` is refused, so a client offers no attach
    #: control. The answer predicts the run: a model whose provider publishes
    #: no modality list widens nothing at run time, so it counts as text-only
    #: here too.
    accepts_query_media: bool
