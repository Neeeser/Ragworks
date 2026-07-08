"""The vector-store backend interface and its capabilities/limits model.

`VectorStoreCapabilities` is the single place a backend's hard limits live —
max indexed dimension, supported metrics, name rules, batch/query caps.
Every enforcement site (create-index validation, pipeline node validation,
upsert batching, the wizard via the API) reads these values off the backend;
re-hardcoding a limit anywhere else is a lockstep bug.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

from app.retrieval.models import DocumentChunk, RetrievalResponse
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError

# Shared across backends (it is Pinecone's rule, reused for pgvector so index
# names stay portable); for pgvector it doubles as the SQL-injection guard on
# dynamically built identifiers.
INDEX_NAME_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


class VectorStoreCapabilities(BaseModel):
    """A backend's hard limits, declared as data."""

    model_config = ConfigDict(frozen=True)

    max_dimension: int
    supported_metrics: tuple[str, ...]
    index_name_max_length: int = 45
    max_upsert_batch: int = 1000
    max_top_k: int = 10000
    requires_api_key: bool


class IndexSpec(BaseModel):
    """Parameters for creating (or ensuring) a vector index.

    `cloud`/`region`/`deletion_protection` are Pinecone-only extras; the
    pgvector backend ignores them.
    """

    name: str
    dimension: int = Field(gt=0)
    metric: str = "cosine"
    cloud: str | None = None
    region: str | None = None
    deletion_protection: str | None = None


class VectorIndexDescription(BaseModel):
    """Backend-agnostic description of one vector index."""

    name: str
    backend: IndexBackend
    dimension: int | None = None
    metric: str | None = None
    vector_type: str | None = None
    status: dict[str, Any] | None = None
    host: str | None = None
    spec: dict[str, Any] | None = None
    deletion_protection: str | None = None
    tags: dict[str, str] | None = None


def validate_index_name(name: str, capabilities: VectorStoreCapabilities) -> None:
    """Reject an index name that violates the shared name rule.

    Raises `InvalidInputError` so routes translate it to a 400.
    """
    if len(name) > capabilities.index_name_max_length:
        raise InvalidInputError(
            f"Index name must be at most {capabilities.index_name_max_length} characters."
        )
    if not INDEX_NAME_PATTERN.fullmatch(name):
        raise InvalidInputError(
            "Index name must be lowercase letters, digits, and hyphens, and cannot "
            "start or end with a hyphen."
        )


def validate_index_spec(spec: IndexSpec, capabilities: VectorStoreCapabilities) -> None:
    """Validate a create-index spec against a backend's capabilities."""
    validate_index_name(spec.name, capabilities)
    if spec.dimension > capabilities.max_dimension:
        raise InvalidInputError(
            f"Dimension {spec.dimension} exceeds this backend's maximum of "
            f"{capabilities.max_dimension}."
        )
    if spec.metric not in capabilities.supported_metrics:
        supported = ", ".join(capabilities.supported_metrics)
        raise InvalidInputError(
            f"Unsupported metric '{spec.metric}'; this backend supports: {supported}."
        )


class VectorStoreBackend(ABC):
    """Write and read access to one vector database, control and data plane.

    Adding a new backend means implementing this interface in its own
    package under `app/vectorstores/`, declaring its `capabilities`, and
    registering it in `app/vectorstores/registry.py` (plus one indexer and
    one retriever node class in `app/pipelines/nodes/`).
    """

    backend: ClassVar[IndexBackend]
    capabilities: ClassVar[VectorStoreCapabilities]

    # -- control plane -----------------------------------------------------

    @abstractmethod
    def list_indexes(self) -> list[VectorIndexDescription]:
        """Return every index visible to this store."""

    @abstractmethod
    def describe_index(self, name: str) -> VectorIndexDescription:
        """Return one index's description; raise `NotFoundError` if absent."""

    @abstractmethod
    def create_index(self, spec: IndexSpec) -> VectorIndexDescription:
        """Create an index (spec already capability-validated by the caller)."""

    @abstractmethod
    def delete_index(self, name: str) -> None:
        """Delete an index and its data; missing index is a no-op."""

    # -- data plane --------------------------------------------------------

    @abstractmethod
    def ensure_index(self, spec: IndexSpec) -> None:
        """Create the index if it does not already exist."""

    @abstractmethod
    def upsert(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Upsert embedded chunks into an index namespace."""

    @abstractmethod
    def query(
        self,
        index: str,
        namespace: str,
        *,
        embedding: Sequence[float],
        top_k: int,
        filter: dict[str, Any] | None = None,  # noqa: A002 - mirrors provider APIs
    ) -> RetrievalResponse:
        """Return the nearest chunks for a query embedding."""

    @abstractmethod
    def delete_namespace(self, index: str, namespace: str) -> None:
        """Delete every vector in a namespace; missing namespace is a no-op."""
