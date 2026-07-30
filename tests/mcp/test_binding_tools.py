"""Bound pipelines called over MCP, against a live BM25 index.

The count pipeline runs for real (query input → BM25 count → tool output) so the
whole path an agent exercises is covered: `tools/list` advertisement, argument
handling, `PipelineRunner` execution, and the structured result. A recorded
`QueryEvent` is asserted too — an MCP call must be as observable as a call from
the UI, since that is the promise of routing both through
`ToolInvocationService`.
"""

from __future__ import annotations

import pytest
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
from tests.mcp.conftest import issue_key, rpc
from tests.utils.vectors import pgvector_store


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
                source_port="items",
                target_port="items",
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
    store = pgvector_store(session)
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


class _StubEmbedder:
    """Embedder stand-in: every text embeds to the same fixed vector."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 5, "total_tokens": 5}

    def embed_documents(self, chunks: object) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in chunks]  # type: ignore[union-attr]

    def embed_query(self, _query: str) -> list[float]:
        return [0.1, 0.2, 0.3]


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def embedder(
        self, _connection_id: object, model_name: str, dimensions: object = None
    ) -> _StubEmbedder:
        del dimensions
        return _StubEmbedder(model_name)


def test_calling_the_search_tool_returns_chunks_as_text_and_structured_content(
    mcp_client: TestClient,
    pgvector_session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The default search tool's result carries both channels a client may read.

    The text block is what a model without structured-output support sees; the
    `structuredContent` is what the declared `outputSchema` promises, and it must
    keep the full chunk text even though the text rendering truncates.
    """
    session = pgvector_session
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)
    store = pgvector_store(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    long_text = "Paris is the capital of France. " + ("detail " * 400)
    store.upsert(
        "ragworks",
        f"col-{mcp_collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id="chunk-1",
                text=long_text,
                order=0,
                metadata=DocumentMetadata(data={"filename": "france.md"}),
                embedding=[0.1, 0.2, 0.3],
            )
        ],
    )
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
        {"name": "search_field_notes", "arguments": {"query": "capital of France"}},
    )

    result = body["result"]
    assert isinstance(result, dict)
    assert result["isError"] is False
    text = result["content"][0]["text"]
    assert "1 result(s) for: capital of France" in text
    assert "chunk=chunk-1" in text
    assert text.endswith("…"), "long chunk text is truncated in the text rendering"
    structured = result["structuredContent"]
    assert structured["query"] == "capital of France"
    assert len(structured["chunks"]) == 1
    chunk = structured["chunks"][0]
    # Structured content keeps the whole chunk; only the preview is shortened.
    assert chunk["text"] == long_text
    assert chunk["metadata"] == {"filename": "france.md"}
    assert chunk["document_id"] == "doc-1"


def test_a_failed_pipeline_run_is_a_tool_error_naming_the_trace(
    mcp_client: TestClient,
    session: Session,
    mcp_user: models.User,
    mcp_collection: models.Collection,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A run that dies mid-pipeline must reach the agent as a readable tool
    error, not a protocol failure it cannot act on."""

    class _ExplodingExecutor:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def execute(self, *_args: object, **_kwargs: object) -> None:
            raise RuntimeError("node blew up")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _ExplodingExecutor)
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)
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
        {"name": "search_field_notes", "arguments": {"query": "anything"}},
    )

    result = body["result"]
    assert isinstance(result, dict)
    assert result["isError"] is True
    assert "Retrieval failed" in result["content"][0]["text"]
