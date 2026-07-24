"""Optional tool-pipeline scaffolds the first-run wizard can add.

Beyond the default hybrid search tool (`app/pipelines/defaults.py`), a
collection can start life with structured aggregate tools — count matches,
facet matches by source — and a reranked search tool. These builders mirror
the frontend's `pipeline-templates.ts` so a wizard-scaffolded tool is byte-for-
byte the graph the standalone create-pipeline wizard would produce, and
`with_reranker` splices a reranker into an existing retrieval definition the
same way the "Reranked search" template does.
"""

from __future__ import annotations

from uuid import UUID

from app.pipelines.defaults import DEFAULT_RESULT_LIMIT_VARIABLE, bm25_sibling_index_name
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.reranking import RerankerNode
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.schemas.enums import IndexBackend

#: Default tool identities exposed to the assistant, matching the frontend
#: aggregate templates so the two scaffolding paths never diverge.
COUNT_TOOL_NAME = "count_matches"
COUNT_TOOL_DESCRIPTION = "Count how many documents and chunks match the query text."
FACET_TOOL_NAME = "facet_matches"
FACET_TOOL_DESCRIPTION = "Group matching chunks by source file with document and chunk counts."

#: The reranked template over-fetches so the reranker reorders a wider set than
#: the final result limit keeps — reranking after the cut only reorders chunks
#: already chosen.
_OVERFETCH_MULTIPLIER = 3
_RERANK_NODE_ID = "rerank-results"


def _build_aggregate_pipeline(
    *,
    aggregate_type: str,
    node_name: str,
    tool_name: str,
    tool_description: str,
    backend: IndexBackend,
    index_name: str,
) -> PipelineDefinition:
    """Build a query-input → BM25 aggregate → tool-output structured graph.

    Aggregate tools read the collection's BM25 sibling index (populated by the
    hybrid ingestion pipeline), derived from the selected dense index name.
    """
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="query-input",
                type="retrieval.input",
                name="Query",
                config={"tool_name": tool_name, "tool_description": tool_description},
            ),
            PipelineNodeDefinition(
                id="aggregate",
                type=aggregate_type,
                name=node_name,
                config={
                    "backend": backend.value,
                    "index_name": bm25_sibling_index_name(index_name, backend),
                    "namespace": DEFAULT_NAMESPACE_TEMPLATE,
                },
            ),
            PipelineNodeDefinition(
                id="tool-output",
                type="tool.output",
                name="Tool Output",
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-input-aggregate",
                source="query-input",
                target="aggregate",
                source_port="request",
                target_port="request",
            ),
            PipelineEdgeDefinition(
                id="edge-aggregate-output",
                source="aggregate",
                target="tool-output",
                source_port="values",
                target_port="values",
            ),
        ],
        viewport={},
    )


def build_count_tool_pipeline(
    *, backend: IndexBackend, index_name: str
) -> PipelineDefinition:
    """Return the structured count tool definition (`count.bm25`)."""
    return _build_aggregate_pipeline(
        aggregate_type="count.bm25",
        node_name="Count Matches",
        tool_name=COUNT_TOOL_NAME,
        tool_description=COUNT_TOOL_DESCRIPTION,
        backend=backend,
        index_name=index_name,
    )


def build_facet_tool_pipeline(
    *, backend: IndexBackend, index_name: str
) -> PipelineDefinition:
    """Return the structured facet-by-source tool definition (`facet.bm25`)."""
    return _build_aggregate_pipeline(
        aggregate_type="facet.bm25",
        node_name="Facet by Source",
        tool_name=FACET_TOOL_NAME,
        tool_description=FACET_TOOL_DESCRIPTION,
        backend=backend,
        index_name=index_name,
    )


def with_reranker(
    definition: PipelineDefinition,
    *,
    connection_id: UUID,
    model_name: str,
) -> PipelineDefinition:
    """Splice a reranker into a retrieval definition, upstream of the cut.

    Insert a `reranker.model` node just before the cut point — the result-limit
    node when present, else the retrieval output — and rewire the edge feeding
    that cut to pass through the reranker first. When a limit exists, retriever
    fetch depth is widened to `result_limit * N` so the reranker has extra
    candidates to reorder before the limit trims back. A definition with no cut
    point (no limit and no output) is returned unchanged.
    """
    limit_node = next(
        (node for node in definition.nodes if node.type == ResultLimitNode.type), None
    )
    target = limit_node or next(
        (node for node in definition.nodes if node.type == "retrieval.output"), None
    )
    if target is None:
        return definition

    nodes = [
        _widen_retriever(node) if (limit_node and _is_retriever(node)) else node
        for node in definition.nodes
    ]
    nodes.append(
        PipelineNodeDefinition(
            id=_RERANK_NODE_ID,
            type=RerankerNode.type,
            name="Reranker",
            config={"connection_id": str(connection_id), "model_name": model_name},
        )
    )
    edges = [
        edge.model_copy(update={"target": _RERANK_NODE_ID}) if edge.target == target.id else edge
        for edge in definition.edges
    ]
    edges.append(
        PipelineEdgeDefinition(
            id="edge-reranker-target",
            source=_RERANK_NODE_ID,
            target=target.id,
            source_port="results",
            target_port="results",
        )
    )
    return definition.model_copy(update={"nodes": nodes, "edges": edges})


def _is_retriever(node: PipelineNodeDefinition) -> bool:
    """True for any retriever node whose fetch depth reranking should widen."""
    return node.type.startswith("retriever.")


def _widen_retriever(node: PipelineNodeDefinition) -> PipelineNodeDefinition:
    """Return a copy of a retriever node fetching `result_limit * N` candidates."""
    over_fetch = {"$expr": f"{DEFAULT_RESULT_LIMIT_VARIABLE.name} * {_OVERFETCH_MULTIPLIER}"}
    return node.model_copy(update={"config": {**(node.config or {}), "top_k": over_fetch}})
