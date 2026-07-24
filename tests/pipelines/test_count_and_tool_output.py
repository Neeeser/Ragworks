"""The BM25 count/facet nodes and the structured `tool.output` terminal.

Together they are the structured tools (#133): query in, counts or facet
buckets out — the smallest graphs exercising the discriminated ToolResult
end to end.
"""

from __future__ import annotations

import json
from uuid import uuid4

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.interface import ToolOutputKind, derive_interface
from app.pipelines.nodes.counting import (
    Bm25CountConfig,
    Bm25CountNode,
    Bm25FacetConfig,
    Bm25FacetNode,
)
from app.pipelines.nodes.tool_output import ToolOutputConfig, ToolOutputNode
from app.pipelines.payloads import (
    RetrievalPayload,
    RetrievalRequestPayload,
    StructuredValuesPayload,
    dump_outputs,
)
from app.pipelines.registry import default_registry
from app.retrieval.models import QueryRequest
from app.schemas.enums import IndexBackend
from app.services.errors import NotFoundError
from app.utils.file_storage import FileStorage
from app.vectorstores.base import FacetBucket, LexicalCountResult
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
)


def _context(session: Session, store: StubVectorStore) -> PipelineRunContext:
    return PipelineRunContext(
        session=session,
        user=models.User(id=uuid4(), email="count@t.local", hashed_password="hashed"),
        collection=models.Collection(
            id=uuid4(), user_id=uuid4(), name="C", description="", extra_metadata={}
        ),
        document=None,
        query="aurora",
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(),
        settings=get_settings(),
    )


def _request_input() -> dict[str, object]:
    return {
        "request": RetrievalRequestPayload(
            request=QueryRequest(text="aurora", top_k=5, namespace=None)
        )
    }


class TestBm25CountNode:
    def test_counts_matches_through_the_store(self, session: Session) -> None:
        store = StubVectorStore()
        store.lexical_count_result = LexicalCountResult(
            matching_documents=2, matching_chunks=3
        )
        node = Bm25CountNode(
            Bm25CountConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
        )

        outputs = node.run(_request_input(), _context(session, store))

        payload = StructuredValuesPayload.model_validate(outputs["values"])
        assert payload.values == {"matching_documents": 2, "matching_chunks": 3}

    def test_missing_index_counts_zero(self, session: Session) -> None:
        """Mirrors the retriever contract: querying between setup and first
        ingest never 404s — a not-yet-created index holds nothing."""
        store = StubVectorStore()
        store.lexical_count_error = NotFoundError("no index")
        node = Bm25CountNode(
            Bm25CountConfig(backend=IndexBackend.PGVECTOR, index_name="missing")
        )

        outputs = node.run(_request_input(), _context(session, store))

        payload = StructuredValuesPayload.model_validate(outputs["values"])
        assert payload.values == {"matching_documents": 0, "matching_chunks": 0}

    def test_validation_rejects_backends_without_count_support(self) -> None:
        node = PipelineNodeDefinition(
            id="count",
            type=Bm25CountNode.type,
            name="Count",
            config={"backend": "pinecone", "index_name": "docs-bm25"},
        )
        issues = Bm25CountNode.validation_issues_for_node(
            node, PipelineDefinition(nodes=[node], edges=[]), default_registry()
        )
        assert any("count" in issue.message.lower() for issue in issues)


class TestBm25FacetNode:
    def test_facets_matches_through_the_store(self, session: Session) -> None:
        store = StubVectorStore()
        store.lexical_facet_result = [
            FacetBucket(value="alpha.md", matching_documents=1, matching_chunks=2),
            FacetBucket(value="beta.md", matching_documents=1, matching_chunks=1),
        ]
        node = Bm25FacetNode(
            Bm25FacetConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
        )

        outputs = node.run(_request_input(), _context(session, store))

        payload = StructuredValuesPayload.model_validate(outputs["values"])
        assert payload.values["facet_field"] == "filename"
        assert payload.values["facets"] == store.lexical_facet_result
        assert store.lexical_facet_calls[0]["field"] == "filename"
        assert store.lexical_facet_calls[0]["top_n"] == 10

    def test_missing_index_facets_empty(self, session: Session) -> None:
        """Mirrors the count/retriever contract: a not-yet-created index
        holds nothing — an honest empty facet list, not an error."""
        store = StubVectorStore()
        store.lexical_facet_error = NotFoundError("no index")
        node = Bm25FacetNode(
            Bm25FacetConfig(backend=IndexBackend.PGVECTOR, index_name="missing")
        )

        outputs = node.run(_request_input(), _context(session, store))

        payload = StructuredValuesPayload.model_validate(outputs["values"])
        assert payload.values["facets"] == []

    def test_misconfigured_target_facets_empty(self, session: Session) -> None:
        """A name that resolves to a dense index degrades to an empty facet
        list rather than failing the tool run."""
        from app.services.errors import InvalidInputError

        store = StubVectorStore()
        store.lexical_facet_error = InvalidInputError("not a sparse index")
        node = Bm25FacetNode(
            Bm25FacetConfig(backend=IndexBackend.PGVECTOR, index_name="dense-docs")
        )

        outputs = node.run(_request_input(), _context(session, store))

        payload = StructuredValuesPayload.model_validate(outputs["values"])
        assert payload.values["facets"] == []

    def test_validation_rejects_backends_without_facet_support(self) -> None:
        node = PipelineNodeDefinition(
            id="facet",
            type=Bm25FacetNode.type,
            name="Facet",
            config={"backend": "pinecone", "index_name": "docs-bm25"},
        )
        issues = Bm25FacetNode.validation_issues_for_node(
            node, PipelineDefinition(nodes=[node], edges=[]), default_registry()
        )
        assert any("facet" in issue.message.lower() for issue in issues)

    def test_trace_summary_is_json_safe(self, session: Session) -> None:
        """Trace summaries persist to a JSON column — facet buckets must be
        dumped to primitives before they reach the recorder."""
        store = StubVectorStore()
        store.lexical_facet_result = [
            FacetBucket(value="alpha.md", matching_documents=1, matching_chunks=2)
        ]
        node = Bm25FacetNode(
            Bm25FacetConfig(backend=IndexBackend.PGVECTOR, index_name="docs-bm25")
        )
        inputs = _request_input()

        outputs = node.run(inputs, _context(session, store))
        summary = node.summarize_io(inputs, outputs)

        for entry in summary.outputs:
            json.dumps(entry.value)  # raises if a model leaked through


class TestToolOutputNode:
    def test_merges_structured_values_into_the_result_payload(
        self, session: Session
    ) -> None:
        node = ToolOutputNode(ToolOutputConfig())

        outputs = node.run(
            {
                "values": [
                    StructuredValuesPayload(values={"matching_documents": 2}),
                    StructuredValuesPayload(values={"matching_chunks": 3}),
                ]
            },
            _context(session, StubVectorStore()),
        )

        payload = RetrievalPayload.model_validate(outputs["result"])
        assert payload.response.matches == []
        assert payload.outputs == {"matching_documents": 2, "matching_chunks": 3}

    def test_merges_facet_values_and_dumps_json_safe(self, session: Session) -> None:
        """Facet buckets flow through the terminal typed, and `dump_outputs`
        renders them JSON-safe for the wire and the query-event column."""
        buckets = [FacetBucket(value="alpha.md", matching_documents=1, matching_chunks=2)]
        node = ToolOutputNode(ToolOutputConfig())

        outputs = node.run(
            {
                "values": [
                    StructuredValuesPayload(
                        values={"facet_field": "filename", "facets": buckets}
                    )
                ]
            },
            _context(session, StubVectorStore()),
        )

        payload = RetrievalPayload.model_validate(outputs["result"])
        assert payload.outputs["facets"] == buckets
        dumped = dump_outputs(payload.outputs)
        json.dumps(dumped)  # raises if a model leaked through
        assert dumped["facets"] == [
            {"value": "alpha.md", "matching_documents": 1, "matching_chunks": 2}
        ]

    def test_registry_serves_both_nodes(self) -> None:
        registry = default_registry()
        assert registry.get_node_class(Bm25CountNode.type) is Bm25CountNode
        assert registry.get_node_class(ToolOutputNode.type) is ToolOutputNode

    def test_count_pipeline_derives_a_structured_callable_interface(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="in",
                    type="retrieval.input",
                    name="Input",
                    config={"tool_name": "count_matches"},
                ),
                PipelineNodeDefinition(
                    id="count",
                    type=Bm25CountNode.type,
                    name="Count",
                    config={"backend": "pgvector", "index_name": "docs-bm25"},
                ),
                PipelineNodeDefinition(id="out", type=ToolOutputNode.type, name="Out"),
            ],
            edges=[],
        )
        interface = derive_interface(definition)
        assert interface.callable is True
        assert interface.output_kind is ToolOutputKind.STRUCTURED
        assert interface.tool_name == "count_matches"
