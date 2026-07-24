"""Bound pipelines called over MCP, against a live BM25 index.

The count pipeline runs for real (query input → BM25 count → tool output) so the
whole path an agent exercises is covered: `tools/list` advertisement, argument
handling, `PipelineRunner` execution, and the structured result. A recorded
`QueryEvent` is asserted too — an MCP call must be as observable as a call from
the UI, since that is the promise of routing both through
`ToolInvocationService`.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.enums import ApiKeyCapability
from app.services.collection_tools import CollectionToolService
from app.services.pipelines import PipelineService
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore
from tests.mcp.conftest import issue_key, rpc


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


def _chunk(chunk_id: str, text: str, document_id: str) -> DocumentChunk:
    return DocumentChunk(
        document_id=document_id,
        chunk_id=chunk_id,
        text=text,
        order=0,
        metadata=DocumentMetadata(data={}),
    )


def _bind_count_tool(
    session: Session, user: models.User, collection: models.Collection
) -> None:
    """Seed a BM25 index and bind a count pipeline as a second tool."""
    store = PgvectorStore(session)
    store.create_index(IndexSpec(name="mcp-counts-bm25", vector_type="sparse"))
    store.upsert_lexical(
        "mcp-counts-bm25",
        "ns",
        [
            _chunk("a:0", "the aurora shimmered", "doc-a"),
            _chunk("a:1", "aurora shift notes", "doc-a"),
            _chunk("b:0", "aurora maintenance window", "doc-b"),
            _chunk("c:0", "tidepool consensus", "doc-c"),
        ],
    )
    pipeline = PipelineService(session).create_pipeline(
        user=user, name="Count matches", definition=_count_definition("mcp-counts-bm25")
    )
    session.commit()
    CollectionToolService(session).add_tool(user, collection, pipeline.id)
    session.commit()


def test_tools_list_advertises_the_pipelines_schema_and_hints(
    mcp_client: TestClient,
    session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """The MCP listing is the chat projection: same names, same parameters."""
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(mcp_client, mcp_collection.id, secret, "tools/list")

    result = body["result"]
    assert isinstance(result, dict)
    tool = result["tools"][0]
    assert tool["name"] == "search_field_notes"
    assert tool["inputSchema"]["required"] == ["query"]
    assert tool["inputSchema"]["properties"]["query"]["type"] == "string"
    # A chunk-returning tool declares its result schema, so a client can rely on
    # `structuredContent` instead of parsing the text rendering.
    assert tool["outputSchema"]["properties"]["chunks"]["type"] == "array"
    assert tool["annotations"]["readOnlyHint"] is True
    assert "Observations from the field." in tool["description"]


def test_calling_a_structured_tool_returns_structured_content(
    mcp_client: TestClient,
    pg_search_session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    session = pg_search_session
    _bind_count_tool(session, mcp_user, mcp_collection)
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "tools/call",
        {"name": "count_matches_field_notes", "arguments": {"query": "aurora"}},
    )

    result = body["result"]
    assert isinstance(result, dict)
    assert result["isError"] is False
    assert result["structuredContent"] == {"matching_documents": 2, "matching_chunks": 3}
    assert "matching_documents: 2" in result["content"][0]["text"]


def test_an_mcp_tool_call_records_a_query_event(
    mcp_client: TestClient,
    pg_search_session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """Agent traffic is as observable as UI traffic — one invocation path."""
    session = pg_search_session
    _bind_count_tool(session, mcp_user, mcp_collection)
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "tools/call",
        {"name": "count_matches_field_notes", "arguments": {"query": "aurora"}},
    )

    with Session(session.get_bind()) as fresh:
        events = list(
            fresh.exec(
                select(models.QueryEvent).where(
                    models.QueryEvent.collection_id == mcp_collection.id
                )
            ).all()
        )
        assert len(events) == 1
        assert events[0].query_text == "aurora"
        assert events[0].pipeline_run_id is not None


def test_missing_query_argument_is_a_tool_error(
    mcp_client: TestClient,
    session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "tools/call",
        {"name": "search_field_notes", "arguments": {}},
    )

    result = body["result"]
    assert isinstance(result, dict)
    assert result["isError"] is True
    assert "query" in result["content"][0]["text"]


def test_disabled_bindings_are_not_advertised(
    mcp_client: TestClient,
    session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """MCP lists what chat would load: enabled bindings only."""
    binding = CollectionPipelineBindingRepository(session).list_for_collection(
        mcp_collection.id, role=models.BindingRole.TOOL
    )[0]
    CollectionToolService(session).set_enabled(
        mcp_user, mcp_collection, binding.id, enabled=False
    )
    session.commit()
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(mcp_client, mcp_collection.id, secret, "tools/list")

    result = body["result"]
    assert isinstance(result, dict)
    assert result["tools"] == []
