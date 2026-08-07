"""The shipped tool-pipeline templates, and the builders behind them.

Beyond the default hybrid search tool (`app/pipelines/defaults.py`), a
collection can start life with structured aggregate tools — count matches,
facet matches by source — and a reranked search tool. `TOOL_TEMPLATES` is the
catalog both scaffolding paths read: the first-run setup wizard calls the
builders directly, and the standalone create-pipeline wizard renders the
catalog and scaffolds through `POST /api/pipelines/tool-templates/{id}`, so
the two produce the same graph by construction rather than by agreement.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from app.pipelines.defaults import (
    DEFAULT_RESULT_LIMIT_VARIABLE,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.counting import Bm25CountNode, Bm25FacetNode
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.reranking import RerankerNode
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError

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

    `index_name` is the sparse index itself — these tools read nothing dense,
    so a caller holding a dense name derives the BM25 sibling
    (`bm25_sibling_index_name`) before calling.
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
                    "index_name": index_name,
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
                source_port="items",
                target_port="items",
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


def build_count_tool_pipeline(*, backend: IndexBackend, index_name: str) -> PipelineDefinition:
    """Return the structured count tool definition (`count.bm25`)."""
    return _build_aggregate_pipeline(
        aggregate_type="count.bm25",
        node_name="Count Matches",
        tool_name=COUNT_TOOL_NAME,
        tool_description=COUNT_TOOL_DESCRIPTION,
        backend=backend,
        index_name=index_name,
    )


def build_facet_tool_pipeline(*, backend: IndexBackend, index_name: str) -> PipelineDefinition:
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
            source_port="items",
            target_port="items",
        )
    )
    return definition.model_copy(update={"nodes": nodes, "edges": edges})


@dataclass(frozen=True)
class ToolTemplateChoices:
    """What a template needs from whoever is scaffolding it.

    Every field a template declares (`needs_store`, `needs_embedding`,
    `needs_reranker`) is required when it builds; a template that declares
    none ignores the rest.
    """

    backend: IndexBackend
    index_name: str | None = None
    embedding_connection_id: UUID | None = None
    embedding_model: str | None = None
    reranking_connection_id: UUID | None = None
    reranking_model: str | None = None


@dataclass(frozen=True)
class ToolTemplate:
    """One starting point the create-pipeline wizard offers."""

    id: str
    label: str
    description: str
    #: Whether the template embeds the query — aggregate tools don't.
    needs_embedding: bool
    #: Whether the template reranks, and so needs a reranking model.
    needs_reranker: bool
    #: Whether the graph references a vector-store index at all.
    needs_store: bool
    #: Which kind of index the graph reads — `sparse` for the BM25-only
    #: aggregates, `dense` for the vector-search templates, `None` when the
    #: template names no index. A wizard offering the wrong kind asks for an
    #: index the graph never touches.
    index_vector_type: Literal["dense", "sparse"] | None
    #: The backends that can run this template's nodes.
    supported_backends: tuple[IndexBackend, ...]
    build: Callable[[ToolTemplateChoices], PipelineDefinition]


def build_blank_tool_pipeline(_choices: ToolTemplateChoices) -> PipelineDefinition:
    """Return the bare scaffold: a lone query-input terminal.

    No output terminal: its inbound port is required, and a definition with an
    unconnected required port fails validation — so a two-terminal skeleton
    cannot be saved. The user wires the rest in the editor.
    """
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="query-input", type="retrieval.input", name="Query"),
        ],
        edges=[],
        viewport={},
    )


def _embedding_choice(choices: ToolTemplateChoices) -> tuple[UUID, str]:
    """The embedding pair a query-embedding template cannot build without."""
    if choices.embedding_connection_id is None or not choices.embedding_model:
        raise InvalidInputError("This template needs an embedding connection and model.")
    return choices.embedding_connection_id, choices.embedding_model


def _index_choice(choices: ToolTemplateChoices) -> str:
    """The index name a store-bound template cannot build without."""
    if not choices.index_name:
        raise InvalidInputError("This template needs a vector-store index.")
    return choices.index_name


def _build_hybrid_search(choices: ToolTemplateChoices) -> PipelineDefinition:
    """Semantic + keyword search: the shipped default retrieval graph."""
    connection_id, model = _embedding_choice(choices)
    return build_default_retrieval_pipeline(
        embedding_connection_id=connection_id,
        embedding_model=model,
        backend=choices.backend,
        index_name=_index_choice(choices),
    )


def _build_reranked_search(choices: ToolTemplateChoices) -> PipelineDefinition:
    """Hybrid search with a reranker spliced in ahead of the cut."""
    if choices.reranking_connection_id is None or not choices.reranking_model:
        raise InvalidInputError("This template needs a reranking connection and model.")
    return with_reranker(
        _build_hybrid_search(choices),
        connection_id=choices.reranking_connection_id,
        model_name=choices.reranking_model,
    )


def _build_count_tool(choices: ToolTemplateChoices) -> PipelineDefinition:
    """Count matches: the lexical count aggregate over the BM25 sibling index."""
    return build_count_tool_pipeline(backend=choices.backend, index_name=_index_choice(choices))


def _build_facet_tool(choices: ToolTemplateChoices) -> PipelineDefinition:
    """Facet by source: the lexical facet aggregate over the BM25 sibling index."""
    return build_facet_tool_pipeline(backend=choices.backend, index_name=_index_choice(choices))


#: Every shipped starting point, in the order the wizard offers them.
TOOL_TEMPLATES: tuple[ToolTemplate, ...] = (
    ToolTemplate(
        id="semantic-keyword",
        label="Semantic + keyword search",
        description=(
            "Dense vector search fused with BM25 keyword matching. Returns ranked "
            "chunks — the default search tool."
        ),
        needs_embedding=True,
        needs_reranker=False,
        needs_store=True,
        index_vector_type="dense",
        supported_backends=tuple(IndexBackend),
        build=_build_hybrid_search,
    ),
    ToolTemplate(
        id="reranked",
        label="Reranked search",
        description=(
            "Hybrid search that over-fetches candidates and reorders them with a "
            "reranking model for higher precision."
        ),
        needs_embedding=True,
        needs_reranker=True,
        needs_store=True,
        index_vector_type="dense",
        supported_backends=tuple(IndexBackend),
        build=_build_reranked_search,
    ),
    ToolTemplate(
        id="count",
        label="Count matches",
        description=(
            "Counts how many documents and chunks lexically match the query. "
            "Returns numbers, not ranked chunks."
        ),
        needs_embedding=False,
        needs_reranker=False,
        needs_store=True,
        index_vector_type="sparse",
        supported_backends=Bm25CountNode.supported_backends(),
        build=_build_count_tool,
    ),
    ToolTemplate(
        id="facet",
        label="Facet by source",
        description=(
            "Groups matching chunks by source file, with per-file document and "
            "chunk counts. Returns a breakdown."
        ),
        needs_embedding=False,
        needs_reranker=False,
        needs_store=True,
        index_vector_type="sparse",
        supported_backends=Bm25FacetNode.supported_backends(),
        build=_build_facet_tool,
    ),
    ToolTemplate(
        id="blank",
        label="Blank pipeline",
        description=(
            "Start from just a query input and build the graph yourself. Add "
            "retrieval, aggregate, and output nodes in the editor."
        ),
        needs_embedding=False,
        needs_reranker=False,
        needs_store=False,
        index_vector_type=None,
        supported_backends=tuple(IndexBackend),
        build=build_blank_tool_pipeline,
    ),
)


def tool_template(template_id: str) -> ToolTemplate:
    """The catalog entry with this id, or an `InvalidInputError`."""
    for template in TOOL_TEMPLATES:
        if template.id == template_id:
            return template
    raise InvalidInputError(f"Unknown pipeline template '{template_id}'.")


def _is_retriever(node: PipelineNodeDefinition) -> bool:
    """True for any retriever node whose fetch depth reranking should widen."""
    return node.type.startswith("retriever.")


def _widen_retriever(node: PipelineNodeDefinition) -> PipelineNodeDefinition:
    """Return a copy of a retriever node fetching `result_limit * N` candidates."""
    over_fetch = {"$expr": f"{DEFAULT_RESULT_LIMIT_VARIABLE.name} * {_OVERFETCH_MULTIPLIER}"}
    return node.model_copy(update={"config": {**(node.config or {}), "top_k": over_fetch}})
