"""`VectorStoreBackend` implementation backed by Pinecone.

Control-plane calls delegate to the typed `PineconeIndexAdmin`
(`app/clients/pinecone`); data-plane logic (vector building, match
conversion) lives here — it moved in from the deleted
`app/retrieval/indexers/pinecone_indexer.py` and
`app/retrieval/retrievers/pinecone_retriever.py`.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, ClassVar

from pinecone import Pinecone, ServerlessSpec  # pylint: disable=no-name-in-module

from app.clients.pinecone import IndexDescription, PineconeIndexAdmin, PineconeMatch, PineconeVector
from app.core.config import get_settings
from app.retrieval.models import (
    DocumentChunk,
    DocumentMetadata,
    RetrievalResponse,
    ScoredChunk,
)
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError, NotFoundError
from app.vectorstores.base import (
    IndexSpec,
    VectorIndexDescription,
    VectorStoreBackend,
    VectorStoreCapabilities,
)

logger = logging.getLogger(__name__)

# The metadata key chunk text is stored under in Pinecone records.
TEXT_METADATA_KEY = "text"

# Limits from docs/external-api/pinecone/reference/api/database-limits.md.
PINECONE_CAPABILITIES = VectorStoreCapabilities(
    max_dimension=20000,
    supported_metrics=("cosine", "euclidean", "dotproduct"),
    supported_vector_types=("dense", "sparse"),
    requires_api_key=True,
)


def is_missing_namespace_error(error: Exception) -> bool:
    """Return True when a Pinecone delete error means the namespace is absent."""
    message = str(error).lower()
    if "namespace not found" in message:
        return True
    status_code = getattr(error, "status_code", None) or getattr(error, "status", None)
    if status_code == 404 and "namespace" in message:
        return True
    response = getattr(error, "response", None)
    response_status = getattr(response, "status_code", None) if response else None
    return response_status == 404 and "namespace" in message


class PineconeStore(VectorStoreBackend):
    """Vector storage in Pinecone serverless indexes."""

    backend: ClassVar[IndexBackend] = IndexBackend.PINECONE
    capabilities: ClassVar[VectorStoreCapabilities] = PINECONE_CAPABILITIES

    def __init__(self, client: Pinecone) -> None:
        """Wrap an already-constructed Pinecone SDK client."""
        self._client = client
        self._admin = PineconeIndexAdmin(client)
        self._indexes: dict[str, Any] = {}

    # -- control plane -----------------------------------------------------

    def list_indexes(self) -> list[VectorIndexDescription]:
        """Return every index visible to this client."""
        return [self._to_description(index) for index in self._admin.list_indexes()]

    def describe_index(self, name: str) -> VectorIndexDescription:
        """Return one index's description."""
        try:
            description = self._admin.describe_index(name)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # The SDK raises version-varying error types for a missing index;
            # classify at the boundary instead of leaking them raw.
            raise NotFoundError(f"Pinecone index '{name}' not found.") from exc
        return self._to_description(description)

    def create_index(self, spec: IndexSpec) -> VectorIndexDescription:
        """Create a serverless index (spec already capability-validated)."""
        settings = get_settings()
        description = self._admin.create_index(
            name=spec.name,
            vector_type=spec.vector_type,
            metric=spec.metric,
            cloud=(spec.cloud or settings.pinecone_cloud).strip(),
            region=(spec.region or settings.pinecone_region).strip(),
            dimension=spec.dimension,
            deletion_protection=spec.deletion_protection,
            tags=spec.tags,
        )
        return self._to_description(description)

    def delete_index(self, name: str) -> None:
        """Delete an index by name and evict cached handles."""
        if self._client.has_index(name):
            self._admin.delete_index(name)
        self._indexes.pop(name, None)

    # -- data plane ----------------------------------------------------------

    def ensure_index(self, spec: IndexSpec) -> None:
        """Create the index if it does not already exist."""
        if self._client.has_index(spec.name):
            return
        if spec.dimension is None:
            raise InvalidInputError("Dense indexes require a dimension.")
        settings = get_settings()
        self._client.create_index(
            name=spec.name,
            dimension=spec.dimension,
            metric=spec.metric,
            spec=ServerlessSpec(
                cloud=(spec.cloud or settings.pinecone_cloud).strip(),
                region=(spec.region or settings.pinecone_region).strip(),
            ),
            deletion_protection=spec.deletion_protection or "disabled",
        )

    def upsert(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Upsert chunk vectors into a Pinecone index namespace."""
        if not chunks:
            return
        vectors: list[PineconeVector] = []
        for chunk in chunks:
            if chunk.embedding is None:
                raise ValueError(f"Chunk {chunk.chunk_id} missing embedding.")
            metadata: dict[str, Any] = dict(chunk.metadata.data)
            metadata["document_id"] = chunk.document_id
            metadata["order"] = chunk.order
            metadata[TEXT_METADATA_KEY] = chunk.text
            vectors.append(
                PineconeVector(id=chunk.chunk_id, values=list(chunk.embedding), metadata=metadata)
            )
        # Serialize at the SDK call boundary: `Index.upsert` accepts plain
        # id/values/metadata dicts (`VectorTypedDict`).
        self._get_index(index).upsert(
            vectors=[vector.model_dump() for vector in vectors],
            namespace=namespace,
        )

    def query(
        self,
        index: str,
        namespace: str,
        *,
        embedding: Sequence[float],
        top_k: int,
        filter: dict[str, Any] | None = None,
    ) -> RetrievalResponse:
        """Return the nearest chunks in a namespace, highest score first."""
        result = self._get_index(index).query(
            vector=list(embedding),
            top_k=min(top_k, self.capabilities.max_top_k),
            include_metadata=True,
            include_values=False,
            namespace=namespace,
            filter=filter,
        )
        # We never pass `async_req`, so this call always returns a
        # `QueryResponse` synchronously; the SDK's overloads still union in
        # the async `ApplyResult`.
        matches = [PineconeMatch.from_sdk(match) for match in result.matches]
        return RetrievalResponse(matches=self._convert_matches(matches))

    def delete_namespace(self, index: str, namespace: str) -> None:
        """Delete a namespace's vectors, tolerating a missing namespace."""
        try:
            self._get_index(index).delete(namespace=namespace, delete_all=True)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # Pinecone raises provider-specific error types; a missing
            # namespace is benign (nothing to purge), anything else is real.
            if not is_missing_namespace_error(exc):
                raise

    def delete_document_vectors(self, index: str, namespace: str, document_id: str) -> None:
        """Delete one document's vectors by chunk-id prefix.

        Serverless indexes support `list` by id prefix
        (docs/external-api/pinecone/guides/manage-data/list-record-ids.md);
        each yielded batch is deleted by ids. A missing namespace means
        nothing was ever indexed — a no-op, matching `delete_namespace`.
        """
        handle = self._get_index(index)
        try:
            for id_batch in handle.list(prefix=f"{document_id}:", namespace=namespace):
                ids = list(id_batch)
                if ids:
                    handle.delete(ids=ids, namespace=namespace)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            if not is_missing_namespace_error(exc):
                raise

    # -- helpers -------------------------------------------------------------

    def _get_index(self, name: str) -> Any:
        """Return a cached data-plane index handle."""
        if name not in self._indexes:
            self._indexes[name] = self._client.Index(name)
        return self._indexes[name]

    @staticmethod
    def _convert_matches(matches: Sequence[PineconeMatch]) -> list[ScoredChunk]:
        """Convert typed Pinecone matches into scored chunks."""
        scored: list[ScoredChunk] = []
        for match in matches:
            metadata_dict = dict(match.metadata)
            text = metadata_dict.pop(TEXT_METADATA_KEY, "")
            document_id = metadata_dict.pop("document_id", match.id)
            order = metadata_dict.pop("order", 0)
            chunk = DocumentChunk(
                document_id=str(document_id),
                chunk_id=match.id,
                text=str(text),
                order=int(order),
                metadata=DocumentMetadata(data=metadata_dict),
            )
            scored.append(ScoredChunk(chunk=chunk, score=match.score))
        return scored

    @staticmethod
    def _to_description(description: IndexDescription) -> VectorIndexDescription:
        """Map the typed admin description onto the backend-agnostic shape."""
        return VectorIndexDescription(
            backend=IndexBackend.PINECONE,
            **description.model_dump(exclude={"embed"}),
        )
