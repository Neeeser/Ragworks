"""End-to-end structured tool invocation: count/facet pipelines → ToolResult.

Builds the real aggregate graphs (query input → BM25 count/facet → tool
output), binds them as collection tools, seeds a live pg_search index, and
invokes through `ToolInvocationService` — the whole discriminated-result
path the search page and chat consume.
"""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.services.collection_tools import CollectionToolService
from app.services.pipelines import PipelineService
from app.services.tool_invocation import ToolInvocationService
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore
from tests.utils.providers import install_default_pipelines


def _count_definition(index_name: str) -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="query-input",
                type="retrieval.input",
                name="Input",
                config={
                    "tool_name": "count_matches",
                    "tool_description": "Count documents mentioning the query terms.",
                },
            ),
            PipelineNodeDefinition(
                id="count",
                type="count.bm25",
                name="Count",
                config={"backend": "pgvector", "index_name": index_name, "namespace": "ns"},
            ),
            PipelineNodeDefinition(id="tool-output", type="tool.output", name="Output"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1",
                source="query-input",
                target="count",
                source_port="request",
                target_port="request",
            ),
            PipelineEdgeDefinition(
                id="e2",
                source="count",
                target="tool-output",
                source_port="values",
                target_port="values",
            ),
        ],
    )


def _facet_definition(index_name: str) -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="query-input",
                type="retrieval.input",
                name="Input",
                config={
                    "tool_name": "facet_matches",
                    "tool_description": "Group matching chunks by source file.",
                },
            ),
            PipelineNodeDefinition(
                id="facet",
                type="facet.bm25",
                name="Facet",
                config={"backend": "pgvector", "index_name": index_name, "namespace": "ns"},
            ),
            PipelineNodeDefinition(id="tool-output", type="tool.output", name="Output"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1",
                source="query-input",
                target="facet",
                source_port="request",
                target_port="request",
            ),
            PipelineEdgeDefinition(
                id="e2",
                source="facet",
                target="tool-output",
                source_port="values",
                target_port="values",
            ),
        ],
    )


def _text_chunk(
    chunk_id: str,
    text: str,
    document_id: str,
    metadata: dict[str, str] | None = None,
) -> DocumentChunk:
    return DocumentChunk(
        document_id=document_id,
        chunk_id=chunk_id,
        text=text,
        order=0,
        metadata=DocumentMetadata(data=metadata or {}),
    )


def test_count_tool_invocation_returns_a_structured_result(
    pg_search_session: Session,
) -> None:
    session = pg_search_session
    user = models.User(email="count@example.com", full_name="C", hashed_password="x")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)

    store = PgvectorStore(session)
    store.create_index(IndexSpec(name="counts-bm25", vector_type="sparse"))
    store.upsert_lexical(
        "counts-bm25",
        "ns",
        [
            _text_chunk("a:0", "the aurora shimmered", "doc-a"),
            _text_chunk("a:1", "aurora shift notes", "doc-a"),
            _text_chunk("b:0", "aurora maintenance window", "doc-b"),
            _text_chunk("c:0", "tidepool consensus", "doc-c"),
        ],
    )

    collection = models.Collection(
        user_id=user.id, name="Counted", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Count matches",
        definition=_count_definition("counts-bm25"),
    )
    session.commit()
    binding = CollectionToolService(session).add_tool(user, collection, pipeline.id)
    session.commit()

    result = ToolInvocationService(session).invoke_binding(
        user, collection, binding.id, "aurora"
    )

    assert result.kind == "structured"
    assert result.chunks == []
    assert result.outputs == {"matching_documents": 2, "matching_chunks": 3}
    assert result.pipeline_run_id is not None
    event = session.get(models.QueryEvent, result.query_event_id)
    assert event is not None
    assert event.response_payload["outputs"] == {
        "matching_documents": 2,
        "matching_chunks": 3,
    }


def test_facet_tool_invocation_returns_grouped_buckets(
    pg_search_session: Session,
) -> None:
    """The facet tool answers "which sources mention X" with per-file counts,
    JSON-safe end to end (wire outputs and the query-event column)."""
    session = pg_search_session
    user = models.User(email="facet@example.com", full_name="F", hashed_password="x")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)

    store = PgvectorStore(session)
    store.create_index(IndexSpec(name="facets-bm25", vector_type="sparse"))
    store.upsert_lexical(
        "facets-bm25",
        "ns",
        [
            _text_chunk("a:0", "the aurora shimmered", "doc-a", {"filename": "alpha.md"}),
            _text_chunk("a:1", "aurora shift notes", "doc-a", {"filename": "alpha.md"}),
            _text_chunk("b:0", "aurora maintenance window", "doc-b", {"filename": "beta.md"}),
            _text_chunk("c:0", "tidepool consensus", "doc-c", {"filename": "gamma.md"}),
        ],
    )

    collection = models.Collection(
        user_id=user.id, name="Faceted", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Facet matches",
        definition=_facet_definition("facets-bm25"),
    )
    session.commit()
    binding = CollectionToolService(session).add_tool(user, collection, pipeline.id)
    session.commit()

    result = ToolInvocationService(session).invoke_binding(
        user, collection, binding.id, "aurora"
    )

    assert result.kind == "structured"
    assert result.chunks == []
    assert result.outputs["facet_field"] == "filename"
    assert result.outputs["facets"] == [
        {"value": "alpha.md", "matching_documents": 1, "matching_chunks": 2},
        {"value": "beta.md", "matching_documents": 1, "matching_chunks": 1},
    ]
    event = session.get(models.QueryEvent, result.query_event_id)
    assert event is not None
    assert event.response_payload["outputs"]["facets"] == result.outputs["facets"]


def test_count_tool_before_first_ingest_counts_zero(pg_search_session: Session) -> None:
    """A count tool bound before its index exists answers zero, never 404s —
    the same contract retriever branches follow."""
    session = pg_search_session
    user = models.User(email="zero@example.com", full_name="Z", hashed_password="x")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    collection = models.Collection(
        user_id=user.id, name="Empty", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Count nothing",
        definition=_count_definition(f"missing-{uuid4().hex[:8]}"),
    )
    session.commit()
    binding = CollectionToolService(session).add_tool(user, collection, pipeline.id)
    session.commit()

    result = ToolInvocationService(session).invoke_binding(
        user, collection, binding.id, "anything"
    )

    assert result.kind == "structured"
    assert result.outputs == {"matching_documents": 0, "matching_chunks": 0}
