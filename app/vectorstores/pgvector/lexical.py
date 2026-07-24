"""The pgvector backend's lexical (BM25) plane: sparse tables via pg_search.

Mirrors the dense plane in `repository.py` — same identifier-safety rules
(table names derive from validated index names, values bind as parameters) —
but over `lex_<name>` tables indexed with pg_search's BM25 access method.
Split out of `PgvectorRepository` purely to keep each module within the size
ceiling; the mixin shares the repository's session and public surface.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.db.models import VectorIndexRecord
from app.retrieval.models import DocumentChunk


def lexical_table_name(index_name: str) -> str:
    """Map a validated logical index name onto its sparse (BM25) table name."""
    return "lex_" + index_name.replace("-", "_")


# Descriptive metric recorded on sparse catalog rows (pg_search scores BM25).
BM25_METRIC = "bm25"


class LexicalRepositoryMixin:
    """Sparse-index SQL mixed into `PgvectorRepository` (owner of `_session`)."""

    _session: Session

    def create_lexical_index(self, name: str) -> VectorIndexRecord:
        """Create the sparse (BM25) data table, its indexes, and the catalog row.

        The BM25 index covers `namespace` alongside `text` so pg_search can
        apply the namespace predicate inside the index scan.
        """
        table = lexical_table_name(name)
        self._session.exec(  # type: ignore[call-overload]
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    chunk_id text PRIMARY KEY,
                    namespace text NOT NULL,
                    document_id text NOT NULL,
                    text text NOT NULL,
                    metadata jsonb NOT NULL DEFAULT '{{}}'::jsonb
                )
                """
            )
        )
        self._session.exec(  # type: ignore[call-overload]
            text(
                f"CREATE INDEX IF NOT EXISTS {table}_bm25_idx ON {table} "
                "USING bm25 (chunk_id, namespace, text) WITH (key_field='chunk_id')"
            )
        )
        self._session.exec(  # type: ignore[call-overload]
            text(f"CREATE INDEX IF NOT EXISTS {table}_namespace_idx ON {table} (namespace)")
        )
        record = VectorIndexRecord(
            name=name, dimension=None, metric=BM25_METRIC, vector_type="sparse"
        )
        self._session.add(record)
        self._session.flush()
        return record

    def upsert_lexical_chunks(
        self, name: str, namespace: str, chunks: Sequence[DocumentChunk]
    ) -> None:
        """Insert-or-update chunk text rows in a sparse (BM25) index table."""
        table = lexical_table_name(name)
        statement = text(
            f"""
            INSERT INTO {table} (chunk_id, namespace, document_id, text, metadata)
            VALUES (:chunk_id, :namespace, :document_id, :text, CAST(:metadata AS jsonb))
            ON CONFLICT (chunk_id) DO UPDATE SET
                namespace = EXCLUDED.namespace,
                document_id = EXCLUDED.document_id,
                text = EXCLUDED.text,
                metadata = EXCLUDED.metadata
            """
        )
        # One executemany round trip for the whole batch, not one per chunk.
        self._session.exec(  # type: ignore[call-overload]
            statement,
            params=[
                {
                    "chunk_id": chunk.chunk_id,
                    "namespace": namespace,
                    "document_id": chunk.document_id,
                    "text": chunk.text,
                    "metadata": json.dumps({**chunk.metadata.data, "order": chunk.order}),
                }
                for chunk in chunks
            ],
        )

    def query_lexical(
        self,
        record: VectorIndexRecord,
        namespace: str,
        *,
        query_text: str,
        top_k: int,
    ) -> list[tuple[str, str, str, dict[str, Any], float]]:
        """Return `(chunk_id, document_id, text, metadata, score)` rows, best first.

        Uses pg_search's match-disjunction operator (`|||`), which tokenizes
        the raw query text rather than parsing it as query syntax, and BM25
        scoring via `pdb.score` (verified against pg_search 0.24).
        """
        table = lexical_table_name(record.name)
        statement = text(
            f"""
            SELECT chunk_id, document_id, text, metadata,
                   pdb.score(chunk_id) AS score
            FROM {table}
            WHERE namespace = :namespace AND text ||| :query
            ORDER BY score DESC
            LIMIT :top_k
            """
        )
        rows = self._session.exec(  # type: ignore[call-overload]
            statement,
            params={"namespace": namespace, "query": query_text, "top_k": top_k},
        ).all()
        return [(row[0], row[1], row[2], row[3], float(row[4])) for row in rows]

    def count_lexical(
        self,
        record: VectorIndexRecord,
        namespace: str,
        *,
        query_text: str,
    ) -> tuple[int, int]:
        """Return `(matching_documents, matching_chunks)` for a lexical query.

        Same match semantics as `query_lexical` (pg_search's tokenizing `|||`
        operator), aggregated instead of fetched.
        """
        table = lexical_table_name(record.name)
        statement = text(
            f"""
            SELECT COUNT(DISTINCT document_id), COUNT(*)
            FROM {table}
            WHERE namespace = :namespace AND text ||| :query
            """
        )
        row = self._session.exec(  # type: ignore[call-overload]
            statement,
            params={"namespace": namespace, "query": query_text},
        ).one()
        return int(row[0]), int(row[1])
