"""`VectorStoreBackend` implementation backed by the app's own Postgres."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, ClassVar
from uuid import UUID

from sqlalchemy.exc import DBAPIError
from sqlmodel import Session

from app.db.models import VectorIndexRecord
from app.db.pg_search_support import pg_search_available
from app.retrieval.models import (
    DocumentChunk,
    DocumentMetadata,
    RetrievalResponse,
    ScoredChunk,
)
from app.schemas.enums import IndexBackend
from app.schemas.metadata_filter import MetadataFilter
from app.services.errors import ExternalServiceError, InvalidInputError, NotFoundError
from app.vectorstores.base import (
    FacetBucket,
    IndexSpec,
    IndexStats,
    LexicalCountResult,
    VectorIndexDescription,
    VectorStoreBackend,
    VectorStoreCapabilities,
    validate_index_name,
)
from app.vectorstores.pgvector.repository import PgvectorRepository, to_similarity

# HNSW over fp32 caps at 2,000 dimensions; above that the repository builds
# the index over a halfvec (fp16) cast expression, which raises the indexable
# ceiling to 4,096 (the column itself stays full-precision `vector`).
# Sparse (BM25) indexes ride on the pg_search extension; when it is missing
# at runtime, sparse index creation raises `PG_SEARCH_UNAVAILABLE_DETAIL`.
PGVECTOR_CAPABILITIES = VectorStoreCapabilities(
    max_dimension=4096,
    supported_metrics=("cosine", "l2", "dotproduct"),
    supported_vector_types=("dense", "sparse"),
    supports_lexical_count=True,
    supports_lexical_facet=True,
    supports_metadata_filter=True,
    # One deployment Postgres holds every user's indexes, and an index name
    # maps to exactly one `vec_<name>` table, so a name is shared workspace-wide.
    shared_across_users=True,
    requires_api_key=False,
)

PG_SEARCH_UNAVAILABLE_DETAIL = (
    "The pg_search extension is not available on this deployment's Postgres "
    "server, so BM25 (sparse) indexes on the pgvector backend are disabled."
)


class PgvectorStore(VectorStoreBackend):
    """Vector storage in Postgres via the pgvector extension."""

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    capabilities: ClassVar[VectorStoreCapabilities] = PGVECTOR_CAPABILITIES

    def __init__(self, session: Session, owner_id: UUID) -> None:
        """Bind the store to the request/run session and the acting account."""
        self._repo = PgvectorRepository(session)
        self._owner_id = owner_id

    # -- control plane -----------------------------------------------------

    def list_indexes(self) -> list[VectorIndexDescription]:
        """Return the cataloged indexes this account may see.

        One deployment Postgres holds every account's indexes, so the catalog
        is scoped to the caller: their own indexes plus owner-less ones.
        Listing the whole catalog let any account read off every other
        account's index names.
        """
        return [self._describe(record) for record in self._repo.list_records(self._owner_id)]

    def describe_index(self, name: str) -> VectorIndexDescription:
        """Return one visible index's description from the catalog.

        An index owned by another account is reported as absent, matching
        `list_indexes` — describing it would hand back the scoping the
        listing exists to apply.
        """
        record = self._repo.get_record(name)
        if record is None or not self._visible(record):
            raise NotFoundError(f"pgvector index '{name}' not found.")
        return self._describe(record)

    def stored_namespaces(self, name: str, limit: int = 200) -> list[str]:
        """Return distinct namespaces holding rows in an index (empty if absent)."""
        record = self._repo.get_record(name)
        if record is None:
            return []
        return self._repo.distinct_namespaces(record, limit)

    def create_index(self, spec: IndexSpec) -> VectorIndexDescription:
        """Create the data table and catalog row for a new index."""
        validate_index_name(spec.name, self.capabilities)
        if self._repo.get_record(spec.name) is not None:
            raise InvalidInputError(f"pgvector index '{spec.name}' already exists.")
        if spec.vector_type == "sparse":
            if not pg_search_available():
                raise InvalidInputError(PG_SEARCH_UNAVAILABLE_DETAIL)
            return self._describe(self._repo.create_lexical_index(spec.name, self._owner_id))
        if spec.dimension is None:
            raise InvalidInputError("pgvector indexes require a dimension.")
        record = self._repo.create_index(spec.name, spec.dimension, spec.metric, self._owner_id)
        return self._describe(record)

    def delete_index(self, name: str) -> None:
        """Drop the index's table and catalog row (missing index is a no-op)."""
        validate_index_name(name, self.capabilities)
        self._repo.drop_index(name)

    # -- data plane ----------------------------------------------------------

    def ensure_index(self, spec: IndexSpec) -> None:
        """Create the index if the catalog doesn't know it yet.

        Safe under concurrency: the advisory lock serializes creators of the
        same index, and the post-lock re-check makes every loser a no-op once
        the winner's transaction commits.

        An index the catalog already knows still has its auxiliary indexes
        ensured: a table created before the chunk-lineage index existed would
        otherwise never acquire it, since nothing else issues DDL against the
        dynamically-named `vec_*` tables.
        """
        existing = self._repo.get_record(spec.name)
        if existing is not None:
            if existing.vector_type == "dense":
                self._repo.ensure_document_index(spec.name)
            return
        self._repo.acquire_ddl_lock(spec.name)
        if self._repo.get_record(spec.name) is None:
            self.create_index(spec)

    def upsert(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Upsert embedded chunks, checking dimensions against the index."""
        if not chunks:
            return
        record = self._require_record(index, vector_type="dense")
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
        filter: MetadataFilter | None = None,
    ) -> RetrievalResponse:
        """Return the nearest chunks in a namespace, highest score first."""
        record = self._require_record(index, vector_type="dense")
        rows = self._repo.query_chunks(
            record,
            namespace,
            embedding=embedding,
            top_k=min(top_k, self.capabilities.max_top_k),
            metadata_filter=filter,
        )
        return RetrievalResponse(
            matches=[self._to_scored_chunk(row, record.metric) for row in rows]
        )

    def fetch_document_chunks(
        self, index: str, namespace: str, document_id: str, *, limit: int
    ) -> list[DocumentChunk]:
        """Return one document's stored chunks in chunk order."""
        record = self._repo.get_record(index)
        if record is None:
            # Nothing has been indexed yet; an empty lineage, not an error.
            return []
        rows = self._repo.fetch_document_chunks(record, namespace, document_id, limit=limit)
        return [self._to_chunk(row) for row in rows]

    @staticmethod
    def _to_chunk(row: tuple[str, str, str, dict[str, Any]]) -> DocumentChunk:
        """Convert one lineage row into a chunk, lifting `order` out of metadata."""
        chunk_id, document_id, chunk_text, metadata = row
        data = dict(metadata)
        order = data.pop("order", 0)
        return DocumentChunk(
            document_id=document_id,
            chunk_id=chunk_id,
            text=chunk_text,
            order=int(order),
            metadata=DocumentMetadata(data=data),
        )

    def upsert_lexical(self, index: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Upsert chunk texts into a sparse (BM25) index."""
        if not chunks:
            return
        self._require_record(index, vector_type="sparse")
        self._repo.upsert_lexical_chunks(index, namespace, chunks)

    def lexical_query(
        self,
        index: str,
        namespace: str,
        *,
        text: str,
        top_k: int,
        filter: MetadataFilter | None = None,
    ) -> RetrievalResponse:
        """Return the BM25 best-matching chunks for raw query text."""
        record = self._require_record(index, vector_type="sparse")
        try:
            rows = self._repo.query_lexical(
                record,
                namespace,
                query_text=text,
                top_k=min(top_k, self.capabilities.max_top_k),
                metadata_filter=filter,
            )
        except DBAPIError as exc:
            # The BM25 operators come from the pg_search extension; if it is
            # dropped after the index was created, the raw SQL fails at the
            # server. Classify as an infrastructure failure (502), not a 500.
            raise ExternalServiceError(
                f"BM25 query on index '{index}' failed; the pg_search extension "
                "may be unavailable on this Postgres server."
            ) from exc
        # BM25 scores are already higher-is-better; no distance conversion.
        return RetrievalResponse(
            matches=[self._to_scored_chunk(row, record.metric, raw_score=True) for row in rows]
        )

    def lexical_count(self, index: str, namespace: str, *, text: str) -> LexicalCountResult:
        """Count BM25-matching documents/chunks without fetching matches."""
        record = self._require_record(index, vector_type="sparse")
        try:
            documents, chunks = self._repo.count_lexical(record, namespace, query_text=text)
        except DBAPIError as exc:
            # Same classification as `lexical_query`: the BM25 operator comes
            # from pg_search; a dropped extension is infrastructure, not a bug.
            raise ExternalServiceError(
                f"BM25 count on index '{index}' failed; the pg_search extension "
                "may be unavailable on this Postgres server."
            ) from exc
        return LexicalCountResult(matching_documents=documents, matching_chunks=chunks)

    def lexical_facet(
        self,
        index: str,
        namespace: str,
        *,
        text: str,
        field: str,
        top_n: int = 10,
    ) -> list[FacetBucket]:
        """Group BM25-matching chunks by a metadata field's value."""
        record = self._require_record(index, vector_type="sparse")
        try:
            rows = self._repo.facet_lexical(
                record, namespace, query_text=text, field=field, top_n=top_n
            )
        except DBAPIError as exc:
            # Same classification as `lexical_query`: the BM25 operator comes
            # from pg_search; a dropped extension is infrastructure, not a bug.
            raise ExternalServiceError(
                f"BM25 facet on index '{index}' failed; the pg_search extension "
                "may be unavailable on this Postgres server."
            ) from exc
        return [
            FacetBucket(value=value, matching_documents=documents, matching_chunks=chunks)
            for value, documents, chunks in rows
        ]

    def delete_namespace(self, index: str, namespace: str) -> None:
        """Delete a namespace's rows; a missing index means nothing to purge."""
        record = self._repo.get_record(index)
        if record is None:
            return
        self._repo.delete_namespace(record, namespace)

    def delete_document_vectors(self, index: str, namespace: str, document_id: str) -> None:
        """Delete one document's rows; a missing index means nothing to purge."""
        record = self._repo.get_record(index)
        if record is None:
            return
        self._repo.delete_document(record, namespace, document_id)

    # -- diagnostics probe --------------------------------------------------

    def index_stats(self, index: str, namespace: str | None = None) -> IndexStats:
        """Existence via the catalog row, count via the backing table."""
        record = self._repo.get_record(index)
        if record is None:
            return IndexStats(exists=False, count=0)
        return IndexStats(exists=True, count=self._repo.count_vectors(record, namespace))

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _to_scored_chunk(
        row: tuple[str, str, str, dict[str, Any], float],
        metric: str,
        *,
        raw_score: bool = False,
    ) -> ScoredChunk:
        """Convert one repository query row into a scored chunk.

        Dense rows carry a distance that converts to a similarity; lexical
        rows (`raw_score=True`) already carry a higher-is-better BM25 score.
        """
        chunk_id, document_id, chunk_text, metadata, value = row
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
            score=value if raw_score else to_similarity(metric, value),
        )

    def _visible(self, record: VectorIndexRecord) -> bool:
        """Whether the acting account may see an index in the catalog."""
        return record.owner_user_id is None or record.owner_user_id == self._owner_id

    def _require_record(self, index: str, *, vector_type: str | None = None) -> VectorIndexRecord:
        """Return the catalog row, checking its vector type when demanded."""
        record = self._repo.get_record(index)
        if record is None:
            raise NotFoundError(f"pgvector index '{index}' not found.")
        if vector_type is not None and record.vector_type != vector_type:
            raise InvalidInputError(
                f"pgvector index '{index}' is a {record.vector_type} index; "
                f"this operation requires a {vector_type} index."
            )
        return record

    @staticmethod
    def _describe(record: VectorIndexRecord) -> VectorIndexDescription:
        """Build the wire-agnostic description for a cataloged index."""
        return VectorIndexDescription(
            name=record.name,
            backend=IndexBackend.PGVECTOR,
            dimension=record.dimension,
            metric=record.metric,
            vector_type=record.vector_type,
            status={"ready": True, "state": "Ready"},
        )
