"""pgvector store behavior against a real Postgres with the vector extension."""

from __future__ import annotations

import warnings

import pytest
import sqlalchemy
from sqlalchemy import exc as sa_exc
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


def test_schema_inspection_recognizes_vector_columns(pgvector_session: Session) -> None:
    """Reflecting a vec_ table must not warn about the `vector` column type.

    Boot-time schema validation inspects every table's columns; without the
    pgvector SQLAlchemy type registered, reflection emits `SAWarning: Did not
    recognize type 'vector'` on each vec_ table.
    """
    store = PgvectorStore(pgvector_session)
    _make_index(store)

    with warnings.catch_warnings():
        warnings.simplefilter("error", sa_exc.SAWarning)
        inspector = sqlalchemy.inspect(pgvector_session.connection())
        columns = {column["name"] for column in inspector.get_columns("vec_docs")}
    assert "embedding" in columns


def _halfvec_available(session: Session) -> bool:
    """True when the server's pgvector ships the halfvec type (>= 0.7.0)."""
    return (
        session.exec(  # type: ignore[call-overload]
            sqlalchemy.text("SELECT 1 FROM pg_type WHERE typname = 'halfvec'")
        ).first()
        is not None
    )


def _index_definition(session: Session, index_name: str) -> str:
    row = session.exec(  # type: ignore[call-overload]
        sqlalchemy.text("SELECT indexdef FROM pg_indexes WHERE indexname = :name"),
        params={"name": index_name},
    ).first()
    assert row is not None, f"index {index_name} not found"
    return str(row[0])


def test_high_dimension_index_round_trips_via_halfvec(pgvector_session: Session) -> None:
    """Dimensions above the fp32 HNSW cap get a halfvec expression index.

    The column stays full-precision `vector`; only the ANN index quantizes to
    fp16, so >2,000-dim embedding models work on the default backend.
    """
    if not _halfvec_available(pgvector_session):
        pytest.skip("pgvector on the test server predates halfvec (0.7.0)")
    store = PgvectorStore(pgvector_session)
    dimension = 3072
    _make_index(store, name="big", dimension=dimension)

    definition = _index_definition(pgvector_session, "vec_big_embedding_idx")
    assert "hnsw" in definition
    assert "halfvec" in definition

    nearest = [0.0] * dimension
    nearest[0] = 1.0
    farther = [0.0] * dimension
    farther[1] = 1.0
    store.upsert("big", "ns-1", [_chunk("a", nearest), _chunk("b", farther)])

    query = [0.0] * dimension
    query[0] = 0.9
    query[1] = 0.1
    response = store.query("big", "ns-1", embedding=query, top_k=2)
    assert [match.chunk.chunk_id for match in response.matches] == ["a", "b"]


def test_low_dimension_index_keeps_full_precision_hnsw(pgvector_session: Session) -> None:
    """Dimensions within the fp32 HNSW cap keep the plain vector index."""
    store = PgvectorStore(pgvector_session)
    _make_index(store, name="docs", dimension=3)

    definition = _index_definition(pgvector_session, "vec_docs_embedding_idx")
    assert "hnsw" in definition
    assert "halfvec" not in definition
