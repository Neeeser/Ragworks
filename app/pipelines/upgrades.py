"""One-way upgrades applied to stored pipeline definitions.

Node type ids are normally permanent, but the catalog has had explicit one-way
transitions: backend-pinned indexer/retriever variants were superseded by the
unified ``indexer.vector``/``retriever.vector`` nodes, the no-op
``chat.settings`` node was removed, the local ``reranker.cross_encoder`` node
was retired, and this feature branch briefly persisted ``limit.top_n`` before
settling on ``limit.results``. `upgrade_definition` rewrites those stored
definitions to the current vocabulary; startup applies the mechanical rewrite
to every stored version in place, not as a new revision.

Stage-named port keys predating the unified `items` streams are renamed
here too (`LEGACY_ITEM_PORT_KEYS`). The definition-schema v1 -> v2 variables
rewrite lives in `app/pipelines/variables_migration.py`.
"""

from __future__ import annotations

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.indexing import VectorIndexerNode, default_index_name
from app.pipelines.nodes.indexing_legacy import IndexerNode, PgvectorIndexerNode
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.retrieval import (
    PgvectorRetrieverNode,
    PineconeRetrieverNode,
    VectorRetrieverNode,
)
from app.pipelines.result_limit_upgrades import (
    migrate_input_argument_names,
    migrate_node_expressions,
    migrate_top_k_expression,
    migrate_variable,
)
from app.schemas.enums import IndexBackend

# Legacy backend-pinned node type -> (unified type, backend the legacy type pinned).
LEGACY_BACKEND_NODE_TYPES: dict[str, tuple[str, IndexBackend]] = {
    IndexerNode.type: (VectorIndexerNode.type, IndexBackend.PINECONE),
    PgvectorIndexerNode.type: (VectorIndexerNode.type, IndexBackend.PGVECTOR),
    PineconeRetrieverNode.type: (VectorRetrieverNode.type, IndexBackend.PINECONE),
    PgvectorRetrieverNode.type: (VectorRetrieverNode.type, IndexBackend.PGVECTOR),
}

# Node types that no longer exist; their class is gone, so the id is a literal.
REMOVED_NODE_TYPES = frozenset({"chat.settings"})
LEGACY_RERANKER_TYPE = "reranker.cross_encoder"
LEGACY_RESULT_LIMIT_TYPE = "limit.top_n"

# Stage-named port keys from before the unified `items` streams. Every one of
# them named an items-typed port (the embedder's dual `chunks`/`request`
# inputs, its `embedded`/`query_embedding` outputs, chunker/indexer/retriever
# stream ports, and the `results` ranking ports); the current vocabulary uses
# the single key `items`, so the rename is unambiguous and idempotent.
LEGACY_ITEM_PORT_KEYS = frozenset(
    {"chunks", "embedded", "indexed", "request", "query_embedding", "results"}
)


def _upgrade_edge_ports(edge: PipelineEdgeDefinition) -> tuple[PipelineEdgeDefinition, bool]:
    """Rename legacy stage-named ports on an edge to the `items` vocabulary."""
    source_port = "items" if edge.source_port in LEGACY_ITEM_PORT_KEYS else edge.source_port
    target_port = "items" if edge.target_port in LEGACY_ITEM_PORT_KEYS else edge.target_port
    if source_port == edge.source_port and target_port == edge.target_port:
        return edge, False
    return edge.model_copy(update={"source_port": source_port, "target_port": target_port}), True


def _upgrade_node(node: PipelineNodeDefinition) -> tuple[PipelineNodeDefinition, bool]:
    """Return the node rewritten to the unified vocabulary, and whether it changed."""
    if node.type == LEGACY_RESULT_LIMIT_TYPE:
        config = {
            key: migrate_top_k_expression(value)
            for key, value in node.config.items()
            if key != "top_n"
        }
        if "top_n" in node.config:
            config["max_results"] = migrate_top_k_expression(node.config["top_n"])
        upgraded = node.model_copy(
            update={
                "type": ResultLimitNode.type,
                "name": ResultLimitNode.label if node.name == "Top-N" else node.name,
                "config": config,
            }
        )
        return upgraded, True
    mapping = LEGACY_BACKEND_NODE_TYPES.get(node.type)
    if mapping is None:
        return node, False
    unified_type, backend = mapping
    config = {**node.config, "backend": backend.value}
    # Legacy configs could omit the index name and rely on their node type's
    # default; the unified node requires an explicit one, so pin it here.
    if not str(config.get("index_name") or "").strip():
        config["index_name"] = default_index_name(backend)
    upgraded = node.model_copy(update={"type": unified_type, "config": config})
    return upgraded, True


def upgrade_definition(definition: PipelineDefinition) -> PipelineDefinition | None:
    """Return an upgraded copy of the definition, or None when nothing changed."""
    has_legacy_result_limit = any(
        node.type == LEGACY_RESULT_LIMIT_TYPE for node in definition.nodes
    )
    changed = False
    nodes: list[PipelineNodeDefinition] = []
    removed_ids: set[str] = set()
    bypassed_ids: list[str] = []
    for node in definition.nodes:
        if node.type in REMOVED_NODE_TYPES:
            removed_ids.add(node.id)
            changed = True
            continue
        if node.type == LEGACY_RERANKER_TYPE:
            bypassed_ids.append(node.id)
            changed = True
            continue
        upgraded, node_changed = _upgrade_node(node)
        changed = changed or node_changed
        nodes.append(upgraded)
    variables = definition.variables
    if has_legacy_result_limit:
        # ``limit.top_n`` existed on this feature branch after schema v2 had
        # already been stamped. Rewrite that persisted transitional shape here,
        # outside the v1 gate, while retaining node ids and every graph edge.
        variables = [migrate_variable(variable) for variable in definition.variables]
        nodes = [migrate_node_expressions(node) for node in nodes]
        nodes = [migrate_input_argument_names(node) for node in nodes]
    edges = _bypass_nodes(list(definition.edges), bypassed_ids)
    kept_edges: list[PipelineEdgeDefinition] = []
    for edge in edges:
        if edge.source in removed_ids or edge.target in removed_ids:
            changed = True
            continue
        upgraded_edge, edge_changed = _upgrade_edge_ports(edge)
        changed = changed or edge_changed
        kept_edges.append(upgraded_edge)
    if not changed:
        return None
    return definition.model_copy(
        update={"nodes": nodes, "edges": kept_edges, "variables": variables}
    )


def _bypass_nodes(
    edges: list[PipelineEdgeDefinition],
    node_ids: list[str],
) -> list[PipelineEdgeDefinition]:
    """Delete each named node's incident edges and splice every input to every output."""
    rewritten = edges
    for node_id in node_ids:
        incoming = [edge for edge in rewritten if edge.target == node_id]
        outgoing = [edge for edge in rewritten if edge.source == node_id]
        rewritten = [
            edge for edge in rewritten if edge.source != node_id and edge.target != node_id
        ]
        # Never clone a pre-existing identical edge — a duplicate into a
        # variadic port (e.g. fusion) silently double-counts that branch.
        seen = {(e.source, e.target, e.source_port, e.target_port) for e in rewritten}
        for inbound in incoming:
            for outbound in outgoing:
                identity = (
                    inbound.source,
                    outbound.target,
                    inbound.source_port,
                    outbound.target_port,
                )
                if identity in seen:
                    continue
                seen.add(identity)
                rewritten.append(
                    PipelineEdgeDefinition(
                        id=unique_edge_id(f"edge-{inbound.source}-{outbound.target}", rewritten),
                        source=inbound.source,
                        target=outbound.target,
                        source_port=inbound.source_port,
                        target_port=outbound.target_port,
                    )
                )
    return rewritten


def unique_id(base: str, taken: set[str]) -> str:
    """Return `base` (or a numbered variant) not present in `taken`, claiming it."""
    candidate = base
    suffix = 1
    while candidate in taken:
        suffix += 1
        candidate = f"{base}-{suffix}"
    taken.add(candidate)
    return candidate


def unique_edge_id(base: str, edges: list[PipelineEdgeDefinition]) -> str:
    """Return `base` (or a numbered variant) unused by any edge."""
    taken = {edge.id for edge in edges}
    candidate = base
    suffix = 1
    while candidate in taken:
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate
