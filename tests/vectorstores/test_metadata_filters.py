"""Metadata filtering: translators (pure) and live pgvector behavior."""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.metadata_filter import (
    FilterCondition,
    FilterOp,
    MetadataFilter,
    condition_problems,
)
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore
from app.vectorstores.pinecone.filters import to_pinecone_filter
from tests.utils.vectors import pgvector_store


def _filter(*conditions: FilterCondition) -> MetadataFilter:
    return MetadataFilter(all=list(conditions))


class TestConditionProblems:
    def test_sound_conditions_have_no_problems(self) -> None:
        assert condition_problems(FilterCondition(field="author", value="Smith")) == []
        assert condition_problems(FilterCondition(field="year", op=FilterOp.GTE, value=2020)) == []
        assert condition_problems(FilterCondition(field="tag", op=FilterOp.EXISTS)) == []
        assert condition_problems(FilterCondition(field="author", var="author_arg")) == []

    def test_incoherent_shapes_are_named(self) -> None:
        assert condition_problems(FilterCondition(field="a"))  # neither value nor var
        assert condition_problems(FilterCondition(field="a", op=FilterOp.IN, value="not-a-list"))
        assert condition_problems(FilterCondition(field="a", op=FilterOp.GT, value="high"))
        assert condition_problems(FilterCondition(field="a", op=FilterOp.EXISTS, value="x"))
        assert condition_problems(FilterCondition(field="", value="x"))


class TestPineconeTranslation:
    def test_ops_map_to_dollar_syntax(self) -> None:
        result = to_pinecone_filter(
            _filter(
                FilterCondition(field="author", value="Smith"),
                FilterCondition(field="year", op=FilterOp.GTE, value=2020),
                FilterCondition(field="kind", op=FilterOp.IN, value=["a", "b"]),
                FilterCondition(field="tag", op=FilterOp.EXISTS),
            )
        )
        assert result == {
            "$and": [
                {"author": {"$eq": "Smith"}},
                {"year": {"$gte": 2020}},
                {"kind": {"$in": ["a", "b"]}},
                {"tag": {"$exists": True}},
            ]
        }

    def test_empty_filter_is_none(self) -> None:
        assert to_pinecone_filter(None) is None
        assert to_pinecone_filter(MetadataFilter()) is None


def _seed_store(session: Session) -> PgvectorStore:
    store = pgvector_store(session)
    store.create_index(IndexSpec(name="docs", dimension=3, metric="cosine"))
    chunks = [
        DocumentChunk(
            document_id="d1",
            chunk_id="d1:0",
            text="alpha report",
            order=0,
            metadata=DocumentMetadata(data={"author": "Smith", "year": 2020, "reviewed": True}),
            embedding=[1.0, 0.0, 0.0],
        ),
        DocumentChunk(
            document_id="d1",
            chunk_id="d1:1",
            text="beta report",
            order=1,
            metadata=DocumentMetadata(data={"author": "Jones", "year": 2024, "reviewed": False}),
            embedding=[1.0, 0.0, 0.0],
        ),
        DocumentChunk(
            document_id="d1",
            chunk_id="d1:2",
            text="gamma report",
            order=2,
            metadata=DocumentMetadata(data={"year": "unknown"}),
            embedding=[1.0, 0.0, 0.0],
        ),
    ]
    store.upsert("docs", "ns", chunks)
    return store


def _query_ids(store: PgvectorStore, metadata_filter: MetadataFilter | None) -> set[str]:
    response = store.query(
        "docs", "ns", embedding=[1.0, 0.0, 0.0], top_k=10, filter=metadata_filter
    )
    return {match.chunk.chunk_id for match in response.matches}


class TestPgvectorDenseFiltering:
    def test_eq_on_string_and_boolean(self, pgvector_session: Session) -> None:
        store = _seed_store(pgvector_session)
        assert _query_ids(store, _filter(FilterCondition(field="author", value="Smith"))) == {
            "d1:0"
        }
        assert _query_ids(store, _filter(FilterCondition(field="reviewed", value=True))) == {"d1:0"}

    def test_numeric_range_skips_non_numeric_values(self, pgvector_session: Session) -> None:
        store = _seed_store(pgvector_session)
        # d1:2 stores year="unknown" (text) — the range op must not error on it.
        assert _query_ids(
            store, _filter(FilterCondition(field="year", op=FilterOp.GTE, value=2021))
        ) == {"d1:1"}

    def test_in_and_nin(self, pgvector_session: Session) -> None:
        store = _seed_store(pgvector_session)
        assert _query_ids(
            store,
            _filter(FilterCondition(field="author", op=FilterOp.IN, value=["Smith", "Jones"])),
        ) == {"d1:0", "d1:1"}
        # nin keeps chunks missing the field entirely.
        assert _query_ids(
            store,
            _filter(FilterCondition(field="author", op=FilterOp.NIN, value=["Smith"])),
        ) == {"d1:1", "d1:2"}

    def test_exists_and_conjunction(self, pgvector_session: Session) -> None:
        store = _seed_store(pgvector_session)
        assert _query_ids(
            store, _filter(FilterCondition(field="reviewed", op=FilterOp.EXISTS))
        ) == {"d1:0", "d1:1"}
        assert _query_ids(
            store,
            _filter(
                FilterCondition(field="author", value="Smith"),
                FilterCondition(field="year", op=FilterOp.LT, value=2021),
            ),
        ) == {"d1:0"}

    def test_ne_keeps_missing_field(self, pgvector_session: Session) -> None:
        store = _seed_store(pgvector_session)
        assert _query_ids(
            store, _filter(FilterCondition(field="author", op=FilterOp.NE, value="Smith"))
        ) == {"d1:1", "d1:2"}


@pytest.mark.usefixtures("pg_search_session")
class TestPgvectorLexicalFiltering:
    def test_bm25_query_respects_filter(self, pg_search_session: Session) -> None:
        store = pgvector_store(pg_search_session)
        store.create_index(IndexSpec(name="lex", vector_type="sparse"))
        chunks = [
            DocumentChunk(
                document_id="d1",
                chunk_id="d1:0",
                text="the quarterly report",
                order=0,
                metadata=DocumentMetadata(data={"author": "Smith"}),
            ),
            DocumentChunk(
                document_id="d1",
                chunk_id="d1:1",
                text="the quarterly report",
                order=1,
                metadata=DocumentMetadata(data={"author": "Jones"}),
            ),
        ]
        store.upsert_lexical("lex", "ns", chunks)
        response = store.lexical_query(
            "lex",
            "ns",
            text="quarterly report",
            top_k=10,
            filter=_filter(FilterCondition(field="author", value="Jones")),
        )
        assert {match.chunk.chunk_id for match in response.matches} == {"d1:1"}
