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
from pinecone.exceptions import NotFoundException as PineconeNotFoundException

from app.clients.pinecone import (
    LEXICAL_TEXT_FIELD,
    IndexDescription,
    PineconeIndexAdmin,
    PineconeMatch,
    PineconeSearchHit,
    PineconeVector,
)
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

# Limits from docs/external-api/pinecone/reference/api/database-limits.md
# (text-record upserts cap at 96 records per batch vs 1000 with vectors).
PINECONE_CAPABILITIES = VectorStoreCapabilities(
    max_dimension=20000,
    supported_metrics=("cosine", "euclidean", "dotproduct"),
    supported_vector_types=("dense", "sparse"),
    max_lexical_upsert_batch=96,
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


def is_benign_purge_error(error: Exception) -> bool:
    """Return True when a Pinecone purge error means there is nothing to purge.

    Covers both an absent namespace and an absent index (e.g. a hybrid
    pipeline's sparse sibling whose creation never happened) — in either
    case no vectors exist, so the purge already succeeded.
    """
    return isinstance(error, PineconeNotFoundException) or is_missing_namespace_error(error)


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
        """Create a serverless index (spec already capability-validated).

        Sparse indexes are always created with the integrated sparse text
        model: in this app a sparse index exists to serve lexical (BM25)
        search, and a sparse index without integrated embedding cannot be
        text-upserted or text-searched.
        """
        settings = get_settings()
        cloud = (spec.cloud or settings.pinecone_cloud).strip()
        region = (spec.region or settings.pinecone_region).strip()
        if spec.vector_type == "sparse":
            description = self._admin.create_sparse_text_index(
                name=spec.name,
                cloud=cloud,
                region=region,
                deletion_protection=spec.deletion_protection,
                tags=spec.tags,
            )
        else:
            description = self._admin.create_index(
                name=spec.name,
                vector_type=spec.vector_type,
                metric=spec.metric,
                cloud=cloud,
                region=region,
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
        settings = get_settings()
        if spec.vector_type == "sparse":
            self._admin.create_sparse_text_index(
                name=spec.name,
                cloud=(spec.cloud or settings.pinecone_cloud).strip(),
                region=(spec.region or settings.pinecone_region).strip(),
                deletion_protection=spec.deletion_protection,
                tags=spec.tags,
            )
            return
        if spec.dimension is None:
            raise InvalidInputError("Dense indexes require a dimension.")
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

    def upsert_lexical(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Upsert chunk texts as records; the index embeds them server-side."""
        if not chunks:
            return
        records: list[dict[str, Any]] = []
        for chunk in chunks:
            record: dict[str, Any] = dict(chunk.metadata.data)
            record["_id"] = chunk.chunk_id
            record[LEXICAL_TEXT_FIELD] = chunk.text
            record["document_id"] = chunk.document_id
            record["order"] = chunk.order
            records.append(record)
        self._get_index(index).upsert_records(namespace=namespace, records=records)

    def lexical_query(
        self,
        index: str,
        namespace: str,
        *,
        text: str,
        top_k: int,
        filter: dict[str, Any] | None = None,
    ) -> RetrievalResponse:
        """Return the lexically best-matching chunks for raw query text.

        The integrated sparse model embeds the query server-side
        (docs/external-api/pinecone/guides/search/lexical-search.md).
        """
        query: dict[str, Any] = {
            "inputs": {"text": text},
            "top_k": min(top_k, self.capabilities.max_top_k),
        }
        if filter:
            query["filter"] = filter
        try:
            result = self._get_index(index).search(namespace=namespace, query=query)
        except PineconeNotFoundException as exc:
            # Normalized so callers handle a not-yet-created sparse index the
            # same way across backends (pgvector raises NotFoundError too).
            raise NotFoundError(f"Pinecone index '{index}' not found.") from exc
        hits = [PineconeSearchHit.from_sdk(hit) for hit in result.result.hits]
        return RetrievalResponse(matches=[self._hit_to_scored_chunk(hit) for hit in hits])

    def delete_namespace(self, index: str, namespace: str) -> None:
        """Delete a namespace's vectors, tolerating a missing namespace."""
        try:
            self._get_index(index).delete(namespace=namespace, delete_all=True)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # Pinecone raises provider-specific error types; a missing
            # namespace or index is benign (nothing to purge), anything
            # else is real.
            if not is_benign_purge_error(exc):
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
            if not is_benign_purge_error(exc):
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
    def _hit_to_scored_chunk(hit: PineconeSearchHit) -> ScoredChunk:
        """Convert one typed search hit into a scored chunk."""
        fields = dict(hit.fields)
        text_value = fields.pop(LEXICAL_TEXT_FIELD, "")
        document_id = fields.pop("document_id", hit.id)
        order = fields.pop("order", 0)
        metadata = {
            key: value
            for key, value in fields.items()
            if isinstance(value, str | int | float | bool)
        }
        return ScoredChunk(
            chunk=DocumentChunk(
                document_id=str(document_id),
                chunk_id=hit.id,
                text=str(text_value),
                order=int(order) if isinstance(order, int | float) else 0,
                metadata=DocumentMetadata(data=metadata),
            ),
            score=hit.score,
        )

    @staticmethod
    def _to_description(description: IndexDescription) -> VectorIndexDescription:
        """Map the typed admin description onto the backend-agnostic shape."""
        return VectorIndexDescription(
            backend=IndexBackend.PINECONE,
            **description.model_dump(exclude={"embed"}),
        )
