"""All SQL for the pgvector backend: catalog rows, dynamic DDL, and DML.

Every dynamic identifier is derived from an index name that has already
passed `validate_index_name` (strict `[a-z0-9-]`), then mapped through
`data_table_name` — so identifier interpolation is safe by construction.
All values travel as bound parameters; embeddings bind through
`pgvector.sqlalchemy.VECTOR`, whose import also registers the `vector` type
for SQLAlchemy reflection.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy
from pgvector.sqlalchemy import VECTOR
from sqlalchemy import bindparam, text
from sqlmodel import Session, select

from app.db.models import VectorIndexRecord
from app.retrieval.models import DocumentChunk
from app.services.errors import InvalidInputError

# HNSW over an fp32 `vector` column caps at 2,000 dimensions. Above that the
# index is built over a `halfvec` (fp16) cast expression instead — the column
# stays full-precision fp32; only the ANN index quantizes — which raises the
# indexable ceiling to halfvec's 4,096.
HNSW_FP32_MAX_DIMENSION = 2000
HNSW_HALFVEC_MAX_DIMENSION = 4096

# Canonical metric id -> (vector opclass, halfvec opclass, distance operator).
_METRIC_OPS: dict[str, tuple[str, str, str]] = {
    "cosine": ("vector_cosine_ops", "halfvec_cosine_ops", "<=>"),
    "l2": ("vector_l2_ops", "halfvec_l2_ops", "<->"),
    "dotproduct": ("vector_ip_ops", "halfvec_ip_ops", "<#>"),
}


def data_table_name(index_name: str) -> str:
    """Map a validated logical index name onto its data table name."""
    return "vec_" + index_name.replace("-", "_")


def to_similarity(metric: str, distance: float) -> float:
    """Convert a pgvector distance to a Pinecone-comparable similarity score."""
    if metric == "cosine":
        return 1.0 - distance
    # l2: smaller distance is better; ip: pgvector returns the *negative*
    # inner product, so negating both yields higher-is-better scores.
    return -distance


class PgvectorRepository:
    """Data access for pgvector catalog rows and per-index data tables."""

    def __init__(self, session: Session) -> None:
        """Bind to the request/run session (one session owner per request)."""
        self._session = session

    # -- catalog -----------------------------------------------------------

    def get_record(self, name: str) -> VectorIndexRecord | None:
        """Return the catalog row for an index, if it exists."""
        return self._session.get(VectorIndexRecord, name)

    def list_records(self) -> list[VectorIndexRecord]:
        """Return every cataloged index ordered by name."""
        statement = select(VectorIndexRecord).order_by(sqlalchemy.asc(VectorIndexRecord.name))
        return list(self._session.exec(statement).all())

    # -- DDL ---------------------------------------------------------------

    def create_index(self, name: str, dimension: int, metric: str) -> VectorIndexRecord:
        """Create the data table, its indexes, and the catalog row."""
        vector_opclass, halfvec_opclass, _ = _METRIC_OPS[metric]
        table = data_table_name(name)
        self._session.exec(  # type: ignore[call-overload]
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    chunk_id text PRIMARY KEY,
                    namespace text NOT NULL,
                    document_id text NOT NULL,
                    text text NOT NULL,
                    metadata jsonb NOT NULL DEFAULT '{{}}'::jsonb,
                    embedding vector({dimension}) NOT NULL
                )
                """
            )
        )
        if dimension > HNSW_FP32_MAX_DIMENSION:
            self._ensure_halfvec_available(dimension)
            index_target = f"((embedding::halfvec({dimension})) {halfvec_opclass})"
        else:
            index_target = f"(embedding {vector_opclass})"
        self._session.exec(  # type: ignore[call-overload]
            text(
                f"CREATE INDEX IF NOT EXISTS {table}_embedding_idx ON {table} "
                f"USING hnsw {index_target}"
            )
        )
        self._session.exec(  # type: ignore[call-overload]
            text(f"CREATE INDEX IF NOT EXISTS {table}_namespace_idx ON {table} (namespace)")
        )
        record = VectorIndexRecord(name=name, dimension=dimension, metric=metric)
        self._session.add(record)
        self._session.flush()
        return record

    def _ensure_halfvec_available(self, dimension: int) -> None:
        """Reject a >2,000-dim index with a clear error when halfvec is missing.

        halfvec shipped in pgvector 0.7.0; without this check an old server
        surfaces the raw HNSW dimension error as an opaque 500.
        """
        available = self._session.exec(  # type: ignore[call-overload]
            text("SELECT 1 FROM pg_type WHERE typname = 'halfvec'")
        ).first()
        if available is None:
            raise InvalidInputError(
                f"Indexes above {HNSW_FP32_MAX_DIMENSION} dimensions need the halfvec "
                f"type (pgvector >= 0.7.0), which this Postgres server's pgvector "
                f"does not provide; requested dimension {dimension}."
            )

    def drop_index(self, name: str) -> None:
        """Drop the data table and catalog row; missing index is a no-op."""
        self._session.exec(  # type: ignore[call-overload]
            text(f"DROP TABLE IF EXISTS {data_table_name(name)}")
        )
        record = self.get_record(name)
        if record is not None:
            self._session.delete(record)
            self._session.flush()

    # -- DML ---------------------------------------------------------------

    def upsert_chunks(self, name: str, namespace: str, chunks: Sequence[DocumentChunk]) -> None:
        """Insert-or-update chunk rows (embeddings bound via the pgvector type)."""
        table = data_table_name(name)
        statement = text(
            f"""
            INSERT INTO {table} (chunk_id, namespace, document_id, text, metadata, embedding)
            VALUES (:chunk_id, :namespace, :document_id, :text,
                    CAST(:metadata AS jsonb), :embedding)
            ON CONFLICT (chunk_id) DO UPDATE SET
                namespace = EXCLUDED.namespace,
                document_id = EXCLUDED.document_id,
                text = EXCLUDED.text,
                metadata = EXCLUDED.metadata,
                embedding = EXCLUDED.embedding
            """
        ).bindparams(bindparam("embedding", type_=VECTOR()))
        for chunk in chunks:
            if chunk.embedding is None:
                raise ValueError(f"Chunk {chunk.chunk_id} missing embedding.")
            self._session.exec(  # type: ignore[call-overload]
                statement,
                params={
                    "chunk_id": chunk.chunk_id,
                    "namespace": namespace,
                    "document_id": chunk.document_id,
                    "text": chunk.text,
                    "metadata": json.dumps({**chunk.metadata.data, "order": chunk.order}),
                    "embedding": list(chunk.embedding),
                },
            )

    def query_chunks(
        self,
        record: VectorIndexRecord,
        namespace: str,
        *,
        embedding: Sequence[float],
        top_k: int,
    ) -> list[tuple[str, str, str, dict[str, Any], float]]:
        """Return `(chunk_id, document_id, text, metadata, distance)` rows, nearest first."""
        _, _, operator = _METRIC_OPS[record.metric]
        table = data_table_name(record.name)
        if record.dimension > HNSW_FP32_MAX_DIMENSION:
            # Must match the halfvec expression the HNSW index was built over,
            # or the planner falls back to a sequential scan.
            distance = (
                f"embedding::halfvec({record.dimension}) {operator} "
                f"CAST(:embedding AS halfvec({record.dimension}))"
            )
        else:
            distance = f"embedding {operator} :embedding"
        statement = text(
            f"""
            SELECT chunk_id, document_id, text, metadata,
                   {distance} AS distance
            FROM {table}
            WHERE namespace = :namespace
            ORDER BY distance
            LIMIT :top_k
            """
        ).bindparams(bindparam("embedding", type_=VECTOR()))
        rows = self._session.exec(  # type: ignore[call-overload]
            statement,
            params={
                "embedding": list(embedding),
                "namespace": namespace,
                "top_k": top_k,
            },
        ).all()
        return [(row[0], row[1], row[2], row[3], float(row[4])) for row in rows]

    def delete_namespace(self, name: str, namespace: str) -> None:
        """Delete all rows in a namespace (idempotent)."""
        self._session.exec(  # type: ignore[call-overload]
            text(f"DELETE FROM {data_table_name(name)} WHERE namespace = :namespace"),
            params={"namespace": namespace},
        )

    def delete_document(self, name: str, namespace: str, document_id: str) -> None:
        """Delete one document's rows in a namespace (idempotent)."""
        self._session.exec(  # type: ignore[call-overload]
            text(
                f"DELETE FROM {data_table_name(name)} "
                "WHERE namespace = :namespace AND document_id = :document_id"
            ),
            params={"namespace": namespace, "document_id": document_id},
        )
