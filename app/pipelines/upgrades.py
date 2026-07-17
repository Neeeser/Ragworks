"""One-way upgrades applied to stored pipeline definitions.

Node type ids are permanent, but the catalog moves on: the backend-pinned
indexer/retriever variants were superseded by the unified ``indexer.vector``/
``retriever.vector`` nodes (backend selected in config), and the no-op
``chat.settings`` node was removed outright (the chat model is a session-level
choice made in the chat UI). `upgrade_definition` rewrites a stored definition
to the current vocabulary; the startup migration applies it to every stored
version in place -- a mechanical rewrite, not a new revision.
"""

from __future__ import annotations

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.indexing import VectorIndexerNode, default_index_name
from app.pipelines.nodes.indexing_legacy import IndexerNode, PgvectorIndexerNode
from app.pipelines.nodes.retrieval import (
    PgvectorRetrieverNode,
    PineconeRetrieverNode,
    VectorRetrieverNode,
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


def _upgrade_node(node: PipelineNodeDefinition) -> tuple[PipelineNodeDefinition, bool]:
    """Return the node rewritten to the unified vocabulary, and whether it changed."""
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
    changed = False
    nodes: list[PipelineNodeDefinition] = []
    removed_ids: set[str] = set()
    for node in definition.nodes:
        if node.type in REMOVED_NODE_TYPES:
            removed_ids.add(node.id)
            changed = True
            continue
        upgraded, node_changed = _upgrade_node(node)
        changed = changed or node_changed
        nodes.append(upgraded)
    edges: list[PipelineEdgeDefinition] = []
    for edge in definition.edges:
        if edge.source in removed_ids or edge.target in removed_ids:
            changed = True
            continue
        edges.append(edge)
    if not changed:
        return None
    return definition.model_copy(update={"nodes": nodes, "edges": edges})
