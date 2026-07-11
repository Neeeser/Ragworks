"""`VectorStoreBackend` implementation backed by the app's own Postgres."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, ClassVar

from sqlmodel import Session

from app.db.models import VectorIndexRecord
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
    validate_index_name,
)
from app.vectorstores.pgvector.repository import PgvectorRepository, to_similarity

# HNSW over fp32 caps at 2,000 dimensions; above that the repository builds
# the index over a halfvec (fp16) cast expression, which raises the indexable
# ceiling to 4,096 (the column itself stays full-precision `vector`).
PGVECTOR_CAPABILITIES = VectorStoreCapabilities(
    max_dimension=4096,
    supported_metrics=("cosine", "l2", "dotproduct"),
    requires_api_key=False,
)


class PgvectorStore(VectorStoreBackend):
    """Vector storage in Postgres via the pgvector extension."""

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    capabilities: ClassVar[VectorStoreCapabilities] = PGVECTOR_CAPABILITIES

    def __init__(self, session: Session) -> None:
        """Bind the store to the request/run session."""
        self._repo = PgvectorRepository(session)

    # -- control plane -----------------------------------------------------

    def list_indexes(self) -> list[VectorIndexDescription]:
        """Return every cataloged pgvector index."""
        return [self._describe(record.name, record.dimension, record.metric)
                for record in self._repo.list_records()]

    def describe_index(self, name: str) -> VectorIndexDescription:
        """Return one index's description from the catalog."""
        record = self._repo.get_record(name)
        if record is None:
            raise NotFoundError(f"pgvector index '{name}' not found.")
        return self._describe(record.name, record.dimension, record.metric)

    def create_index(self, spec: IndexSpec) -> VectorIndexDescription:
        """Create the data table and catalog row for a new index."""
        validate_index_name(spec.name, self.capabilities)
        if spec.dimension is None:
            raise InvalidInputError("pgvector indexes require a dimension.")
        if self._repo.get_record(spec.name) is not None:
            raise InvalidInputError(f"pgvector index '{spec.name}' already exists.")
        record = self._repo.create_index(spec.name, spec.dimension, spec.metric)
        return self._describe(record.name, record.dimension, record.metric)

    def delete_index(self, name: str) -> None:
        """Drop the index's table and catalog row (missing index is a no-op)."""
        validate_index_name(name, self.capabilities)
        self._repo.drop_index(name)

    # -- data plane ----------------------------------------------------------

    def ensure_index(self, spec: IndexSpec) -> None:
        """Create the index if the catalog doesn't know it yet."""
        if self._repo.get_record(spec.name) is None:
            self.create_index(spec)

    def upsert(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Upsert embedded chunks, checking dimensions against the index."""
        if not chunks:
            return
        record = self._require_record(index)
        for chunk in chunks:
            if chunk.embedding is not None and len(chunk.embedding) != record.dimension:
                raise InvalidInputError(
                    f"Embedding dimension {len(chunk.embedding)} does not match "
                    f"index '{index}' dimension {record.dimension}."
                )
        self._repo.upsert_chunks(index, namespace, chunks)

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
        record = self._require_record(index)
        rows = self._repo.query_chunks(
            record,
            namespace,
            embedding=embedding,
            top_k=min(top_k, self.capabilities.max_top_k),
        )
        return RetrievalResponse(
            matches=[self._to_scored_chunk(row, record.metric) for row in rows]
        )

    def delete_namespace(self, index: str, namespace: str) -> None:
        """Delete a namespace's rows; a missing index means nothing to purge."""
        if self._repo.get_record(index) is None:
            return
        self._repo.delete_namespace(index, namespace)

    def delete_document_vectors(self, index: str, namespace: str, document_id: str) -> None:
        """Delete one document's rows; a missing index means nothing to purge."""
        if self._repo.get_record(index) is None:
            return
        self._repo.delete_document(index, namespace, document_id)

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _to_scored_chunk(
        row: tuple[str, str, str, dict[str, Any], float],
        metric: str,
    ) -> ScoredChunk:
        """Convert one repository query row into a scored chunk."""
        chunk_id, document_id, chunk_text, metadata, distance = row
        data = dict(metadata)
        order = data.pop("order", 0)
        return ScoredChunk(
            chunk=DocumentChunk(
                document_id=document_id,
                chunk_id=chunk_id,
                text=chunk_text,
                order=int(order),
                metadata=DocumentMetadata(data=data),
            ),
            score=to_similarity(metric, distance),
        )

    def _require_record(self, index: str) -> VectorIndexRecord:
        """Return the catalog row or raise `NotFoundError`."""
        record = self._repo.get_record(index)
        if record is None:
            raise NotFoundError(f"pgvector index '{index}' not found.")
        return record

    @staticmethod
    def _describe(name: str, dimension: int, metric: str) -> VectorIndexDescription:
        """Build the wire-agnostic description for a cataloged index."""
        return VectorIndexDescription(
            name=name,
            backend=IndexBackend.PGVECTOR,
            dimension=dimension,
            metric=metric,
            vector_type="dense",
            status={"ready": True, "state": "Ready"},
        )
