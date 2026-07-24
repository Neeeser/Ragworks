"""Optional wizard tool scaffolds: count/facet builders + reranker splice.

These mirror the frontend `pipeline-templates.ts` builders; the shapes are
pinned here so the two scaffolding paths can't drift.
"""

from __future__ import annotations

from uuid import uuid4

from app.pipelines.defaults import build_default_retrieval_pipeline
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.tool_defaults import (
    build_count_tool_pipeline,
    build_facet_tool_pipeline,
    with_reranker,
)
from app.schemas.enums import IndexBackend


def test_count_builder_targets_the_bm25_sibling_index() -> None:
    definition = build_count_tool_pipeline(backend=IndexBackend.PGVECTOR, index_name="docs")

    aggregate = next(node for node in definition.nodes if node.id == "aggregate")
    assert aggregate.type == "count.bm25"
    assert aggregate.config["index_name"] == "docs-bm25"
    types = {node.type for node in definition.nodes}
    assert types == {"retrieval.input", "count.bm25", "tool.output"}


def test_facet_builder_uses_the_facet_node_and_tool_identity() -> None:
    definition = build_facet_tool_pipeline(backend=IndexBackend.PGVECTOR, index_name="docs")

    aggregate = next(node for node in definition.nodes if node.id == "aggregate")
    query_input = next(node for node in definition.nodes if node.id == "query-input")
    assert aggregate.type == "facet.bm25"
    assert query_input.config["tool_name"] == "facet_matches"


def test_with_reranker_splices_before_the_limit_and_widens_fetch() -> None:
    definition = build_default_retrieval_pipeline(
        embedding_connection_id=uuid4(),
        embedding_model="test/model",
        backend=IndexBackend.PGVECTOR,
        index_name="docs",
    )
    connection_id = uuid4()

    result = with_reranker(definition, connection_id=connection_id, model_name="rerank-x")

    rerankers = [node for node in result.nodes if node.type == "reranker.model"]
    assert len(rerankers) == 1
    assert rerankers[0].config == {
        "connection_id": str(connection_id),
        "model_name": "rerank-x",
    }
    # The reranker feeds the cut point (the result-limit node), and the retriever
    # over-fetches so it has extra candidates to reorder before the cut.
    limit_edge = next(edge for edge in result.edges if edge.target == "limit-results")
    assert limit_edge.source == "rerank-results"
    retrievers = [node for node in result.nodes if node.type.startswith("retriever.")]
    assert all(node.config["top_k"] == {"$expr": "result_limit * 3"} for node in retrievers)


def test_with_reranker_returns_definition_unchanged_without_a_cut_point() -> None:
    # A definition with neither a result-limit node nor an output terminal has no
    # cut point, so there is nowhere to splice — return it untouched.
    definition = PipelineDefinition(
        nodes=[PipelineNodeDefinition(id="query-input", type="retrieval.input", name="Query")],
        edges=[],
        viewport={},
    )

    result = with_reranker(definition, connection_id=uuid4(), model_name="rerank-x")

    assert result == definition
