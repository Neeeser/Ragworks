"""pgvector sparse (BM25/pg_search) behavior against a real Postgres.

These tests need the pg_search extension (ParadeDB) and skip with a named
reason when the test server lacks it — run the suite against the bundled
`paradedb/paradedb` image to exercise them.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.exc import ProgrammingError
from sqlmodel import Session

from app.db.pg_search_support import set_pg_search_available
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.services.errors import ExternalServiceError, InvalidInputError, NotFoundError
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore


def _text_chunk(chunk_id: str, text: str, document_id: str = "doc-1") -> DocumentChunk:
    return DocumentChunk(
        document_id=document_id,
        chunk_id=chunk_id,
        text=text,
        order=int(chunk_id.split(":")[-1]) if ":" in chunk_id else 0,
        metadata=DocumentMetadata(data={"source": "test.txt"}),
    )


def _make_sparse_index(store: PgvectorStore, name: str = "docs-bm25") -> None:
    store.create_index(IndexSpec(name=name, vector_type="sparse"))


def test_sparse_index_round_trip(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    _make_sparse_index(store)

    described = store.describe_index("docs-bm25")
    assert described.vector_type == "sparse"
    assert described.dimension is None
    assert described.metric == "bm25"

    assert [index.name for index in store.list_indexes()] == ["docs-bm25"]
    store.delete_index("docs-bm25")
    assert store.list_indexes() == []


def test_sparse_index_rejected_when_pg_search_unavailable(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    set_pg_search_available(False)
    with pytest.raises(InvalidInputError, match="pg_search"):
        _make_sparse_index(store)


def test_lexical_query_ranks_exact_terms_by_bm25(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    _make_sparse_index(store)
    store.upsert_lexical(
        "docs-bm25",
        "ns-1",
        [
            _text_chunk("d1:0", "The quick brown fox jumps over the lazy dog"),
            _text_chunk("d1:1", "Postgres full text search with BM25 ranking"),
            _text_chunk("d2:0", "Reciprocal rank fusion combines search results", "doc-2"),
        ],
    )

    response = store.lexical_query("docs-bm25", "ns-1", text="bm25 ranking", top_k=5)

    assert response.matches
    top = response.matches[0]
    assert top.chunk.chunk_id == "d1:1"
    assert top.chunk.text == "Postgres full text search with BM25 ranking"
    assert top.chunk.document_id == "doc-1"
    assert top.chunk.metadata.data == {"source": "test.txt"}
    assert all(
        earlier.score >= later.score
        for earlier, later in zip(response.matches, response.matches[1:], strict=False)
    )


def test_lexical_namespaces_are_isolated(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    _make_sparse_index(store)
    store.upsert_lexical("docs-bm25", "ns-1", [_text_chunk("a:0", "alpha keyword")])
    store.upsert_lexical("docs-bm25", "ns-2", [_text_chunk("b:0", "alpha keyword", "doc-2")])

    response = store.lexical_query("docs-bm25", "ns-1", text="alpha", top_k=10)
    assert [match.chunk.chunk_id for match in response.matches] == ["a:0"]


def test_lexical_upsert_updates_existing_chunk(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    _make_sparse_index(store)
    store.upsert_lexical("docs-bm25", "ns-1", [_text_chunk("a:0", "original salamander")])
    store.upsert_lexical("docs-bm25", "ns-1", [_text_chunk("a:0", "replacement axolotl")])

    assert store.lexical_query("docs-bm25", "ns-1", text="salamander", top_k=5).matches == []
    matches = store.lexical_query("docs-bm25", "ns-1", text="axolotl", top_k=5).matches
    assert [match.chunk.chunk_id for match in matches] == ["a:0"]


def test_lexical_delete_document_and_namespace(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    _make_sparse_index(store)
    store.upsert_lexical(
        "docs-bm25",
        "ns-1",
        [
            _text_chunk("doc-1:0", "target document text"),
            _text_chunk("doc-2:0", "surviving document text", "doc-2"),
        ],
    )

    store.delete_document_vectors("docs-bm25", "ns-1", "doc-1")
    matches = store.lexical_query("docs-bm25", "ns-1", text="document text", top_k=10).matches
    assert [match.chunk.document_id for match in matches] == ["doc-2"]

    store.delete_namespace("docs-bm25", "ns-1")
    assert store.lexical_query("docs-bm25", "ns-1", text="document", top_k=10).matches == []
    store.delete_namespace("missing-index", "ns-1")  # missing index: no-op


def test_lexical_operations_require_matching_index_type(pg_search_session: Session) -> None:
    store = PgvectorStore(pg_search_session)
    store.create_index(IndexSpec(name="dense-docs", dimension=3, metric="cosine"))
    _make_sparse_index(store)

    with pytest.raises(InvalidInputError, match="dense index"):
        store.lexical_query("dense-docs", "ns-1", text="anything", top_k=5)
    with pytest.raises(InvalidInputError, match="sparse index"):
        store.query("docs-bm25", "ns-1", embedding=[1.0, 0.0, 0.0], top_k=5)
    with pytest.raises(NotFoundError):
        store.lexical_query("missing", "ns-1", text="anything", top_k=5)


def test_lexical_query_wraps_database_errors_as_external(session: Session) -> None:
    """A failing BM25 query (e.g. pg_search lost at runtime) surfaces typed, not raw."""

    class _BrokenRepo:
        @staticmethod
        def get_record(_name: str) -> object:
            return SimpleNamespace(name="docs-bm25", vector_type="sparse", metric="bm25")

        @staticmethod
        def query_lexical(*_args: object, **_kwargs: object) -> object:
            raise ProgrammingError("SELECT ...", {}, Exception("operator does not exist: |||"))

    store = PgvectorStore(session)
    store._repo = _BrokenRepo()  # type: ignore[assignment]

    with pytest.raises(ExternalServiceError):
        store.lexical_query("docs-bm25", "ns", text="q", top_k=5)


class TestLexicalCount:
    """`lexical_count` answers "how many documents/chunks match" without
    fetching matches — the count tool's data plane."""

    def test_counts_distinct_documents_and_chunks(self, pg_search_session: Session) -> None:
        store = PgvectorStore(pg_search_session)
        _make_sparse_index(store)
        store.upsert_lexical(
            "docs-bm25",
            "ns-1",
            [
                _text_chunk("a:0", "the aurora shimmered over the station", "doc-a"),
                _text_chunk("a:1", "aurora observations continued at dawn", "doc-a"),
                _text_chunk("b:0", "aurora forecasts for the week", "doc-b"),
                _text_chunk("c:0", "tidepool consensus rounds", "doc-c"),
            ],
        )

        result = store.lexical_count("docs-bm25", "ns-1", text="aurora")

        assert result.matching_documents == 2
        assert result.matching_chunks == 3

    def test_count_is_namespace_scoped(self, pg_search_session: Session) -> None:
        store = PgvectorStore(pg_search_session)
        _make_sparse_index(store)
        store.upsert_lexical("docs-bm25", "ns-1", [_text_chunk("a:0", "alpha keyword")])
        store.upsert_lexical("docs-bm25", "ns-2", [_text_chunk("b:0", "alpha keyword", "doc-2")])

        result = store.lexical_count("docs-bm25", "ns-1", text="alpha")

        assert result.matching_documents == 1
        assert result.matching_chunks == 1

    def test_count_on_missing_index_raises_not_found(self, pg_search_session: Session) -> None:
        store = PgvectorStore(pg_search_session)
        with pytest.raises(NotFoundError):
            store.lexical_count("no-such-index", "ns", text="anything")

    def test_capability_flag_gates_unsupporting_backends(self) -> None:
        from app.vectorstores.pinecone.store import PineconeStore

        assert PgvectorStore.capabilities.supports_lexical_count is True
        assert PineconeStore.capabilities.supports_lexical_count is False
