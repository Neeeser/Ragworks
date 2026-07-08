"""pgvector store behavior against a real Postgres with the vector extension."""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.services.errors import InvalidInputError, NotFoundError
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore


def _chunk(chunk_id: str, embedding: list[float], text: str = "chunk text") -> DocumentChunk:
    return DocumentChunk(
        document_id="doc-1",
        chunk_id=chunk_id,
        text=text,
        order=0,
        metadata=DocumentMetadata(data={"source": "test.txt"}),
        embedding=embedding,
    )


def _make_index(store: PgvectorStore, name: str = "docs", dimension: int = 3) -> None:
    store.create_index(IndexSpec(name=name, dimension=dimension, metric="cosine"))


def test_create_describe_list_delete_round_trip(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store)

    described = store.describe_index("docs")
    assert described.dimension == 3
    assert described.metric == "cosine"
    assert described.backend.value == "pgvector"

    assert [index.name for index in store.list_indexes()] == ["docs"]

    store.delete_index("docs")
    assert store.list_indexes() == []
    # deleting again is a no-op
    store.delete_index("docs")


def test_create_duplicate_index_rejected(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store)
    with pytest.raises(InvalidInputError, match="already exists"):
        _make_index(store)


def test_create_index_with_invalid_name_rejected_before_ddl(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    with pytest.raises(InvalidInputError):
        store.create_index(IndexSpec(name="Bad_Name", dimension=3, metric="cosine"))


def test_upsert_and_query_returns_nearest_first(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store)
    store.upsert(
        "docs",
        "ns-1",
        [
            _chunk("a", [1.0, 0.0, 0.0], text="apple"),
            _chunk("b", [0.0, 1.0, 0.0], text="banana"),
        ],
    )

    response = store.query("docs", "ns-1", embedding=[0.9, 0.1, 0.0], top_k=2)
    assert [match.chunk.chunk_id for match in response.matches] == ["a", "b"]
    top = response.matches[0]
    assert top.chunk.text == "apple"
    assert top.chunk.document_id == "doc-1"
    assert top.chunk.metadata.data == {"source": "test.txt"}
    assert top.score > response.matches[1].score


def test_upsert_updates_existing_chunk(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store)
    store.upsert("docs", "ns-1", [_chunk("a", [1.0, 0.0, 0.0], text="old")])
    store.upsert("docs", "ns-1", [_chunk("a", [1.0, 0.0, 0.0], text="new")])

    response = store.query("docs", "ns-1", embedding=[1.0, 0.0, 0.0], top_k=5)
    assert [match.chunk.text for match in response.matches] == ["new"]


def test_namespaces_are_isolated(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store)
    store.upsert("docs", "ns-1", [_chunk("a", [1.0, 0.0, 0.0])])
    store.upsert("docs", "ns-2", [_chunk("b", [1.0, 0.0, 0.0])])

    response = store.query("docs", "ns-1", embedding=[1.0, 0.0, 0.0], top_k=10)
    assert [match.chunk.chunk_id for match in response.matches] == ["a"]


def test_delete_namespace_is_idempotent(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store)
    store.upsert("docs", "ns-1", [_chunk("a", [1.0, 0.0, 0.0])])

    store.delete_namespace("docs", "ns-1")
    assert store.query("docs", "ns-1", embedding=[1.0, 0.0, 0.0], top_k=5).matches == []
    store.delete_namespace("docs", "ns-1")  # no rows left: still fine
    store.delete_namespace("missing-index", "ns-1")  # missing index: no-op


def test_dimension_mismatch_rejected(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    _make_index(store, dimension=3)
    with pytest.raises(InvalidInputError, match="dimension"):
        store.upsert("docs", "ns-1", [_chunk("a", [1.0, 0.0])])


def test_query_missing_index_raises_not_found(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    with pytest.raises(NotFoundError):
        store.query("missing", "ns-1", embedding=[1.0, 0.0, 0.0], top_k=5)


def test_ensure_index_creates_once(pgvector_session: Session) -> None:
    store = PgvectorStore(pgvector_session)
    spec = IndexSpec(name="docs", dimension=3, metric="cosine")
    store.ensure_index(spec)
    store.ensure_index(spec)
    assert [index.name for index in store.list_indexes()] == ["docs"]
