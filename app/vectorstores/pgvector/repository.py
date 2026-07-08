"""All SQL for the pgvector backend: catalog rows, dynamic DDL, and DML.

Every dynamic identifier is derived from an index name that has already
passed `validate_index_name` (strict `[a-z0-9-]`), then mapped through
`data_table_name` — so identifier interpolation is safe by construction.
All values travel as bound parameters; embeddings are bound as their pgvector
text form (`"[0.1,0.2]"`) and cast with `::vector` in SQL, which keeps the
backend free of any pgvector Python dependency.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy
from sqlalchemy import text
from sqlmodel import Session, select

from app.db.models import VectorIndexRecord
from app.retrieval.models import DocumentChunk

# Canonical metric id -> (HNSW operator class, distance operator).
_METRIC_OPS: dict[str, tuple[str, str]] = {
    "cosine": ("vector_cosine_ops", "<=>"),
    "l2": ("vector_l2_ops", "<->"),
    "dotproduct": ("vector_ip_ops", "<#>"),
}


def data_table_name(index_name: str) -> str:
    """Map a validated logical index name onto its data table name."""
    return "vec_" + index_name.replace("-", "_")


def embedding_literal(embedding: Sequence[float]) -> str:
    """Serialize an embedding to pgvector's text input format."""
    return "[" + ",".join(repr(float(value)) for value in embedding) + "]"


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
        opclass, _ = _METRIC_OPS[metric]
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
        self._session.exec(  # type: ignore[call-overload]
            text(
                f"CREATE INDEX IF NOT EXISTS {table}_embedding_idx ON {table} "
                f"USING hnsw (embedding {opclass})"
            )
        )
        self._session.exec(  # type: ignore[call-overload]
            text(f"CREATE INDEX IF NOT EXISTS {table}_namespace_idx ON {table} (namespace)")
        )
        record = VectorIndexRecord(name=name, dimension=dimension, metric=metric)
        self._session.add(record)
        self._session.flush()
        return record

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
        """Insert-or-update chunk rows (embeddings bound as pgvector text)."""
        table = data_table_name(name)
        statement = text(
            f"""
            INSERT INTO {table} (chunk_id, namespace, document_id, text, metadata, embedding)
            VALUES (:chunk_id, :namespace, :document_id, :text,
                    CAST(:metadata AS jsonb), CAST(:embedding AS vector))
            ON CONFLICT (chunk_id) DO UPDATE SET
                namespace = EXCLUDED.namespace,
                document_id = EXCLUDED.document_id,
                text = EXCLUDED.text,
                metadata = EXCLUDED.metadata,
                embedding = EXCLUDED.embedding
            """
        )
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
                    "embedding": embedding_literal(chunk.embedding),
                },
            )

    def query_chunks(
        self,
        name: str,
        namespace: str,
        *,
        metric: str,
        embedding: Sequence[float],
        top_k: int,
    ) -> list[tuple[str, str, str, dict[str, Any], float]]:
        """Return `(chunk_id, document_id, text, metadata, distance)` rows, nearest first."""
        _, operator = _METRIC_OPS[metric]
        table = data_table_name(name)
        statement = text(
            f"""
            SELECT chunk_id, document_id, text, metadata,
                   embedding {operator} CAST(:embedding AS vector) AS distance
            FROM {table}
            WHERE namespace = :namespace
            ORDER BY distance
            LIMIT :top_k
            """
        )
        rows = self._session.exec(  # type: ignore[call-overload]
            statement,
            params={
                "embedding": embedding_literal(embedding),
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
