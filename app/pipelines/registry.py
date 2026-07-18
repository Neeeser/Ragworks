"""Registry of available pipeline node types."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.pipelines.definition import PipelineNodeDefinition
from app.pipelines.node import NodeSpec, PipelineNodeBase
from app.pipelines.nodes.chunking import (
    ChunkerNode,
    ParagraphChunkerNode,
    SemanticChunkerNode,
    SentenceChunkerNode,
    TokenChunkerNode,
)
from app.pipelines.nodes.embedding import EmbedderNode
from app.pipelines.nodes.fusion import RRFusionNode
from app.pipelines.nodes.indexing import Bm25IndexerNode, VectorIndexerNode
from app.pipelines.nodes.indexing_legacy import IndexerNode, PgvectorIndexerNode
from app.pipelines.nodes.io import (
    IngestionInputNode,
    IngestionOutputNode,
    RetrievalInputNode,
    RetrievalOutputNode,
)
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.parsing import DocumentParserNode, FileTypeRouterNode
from app.pipelines.nodes.reranking import RerankerNode
from app.pipelines.nodes.retrieval import (
    Bm25RetrieverNode,
    PgvectorRetrieverNode,
    PineconeRetrieverNode,
    VectorRetrieverNode,
)


class NodeRegistry:
    """Registry for available pipeline nodes."""

    def __init__(self, nodes: Iterable[type[PipelineNodeBase[Any]]]) -> None:
        """Initialize the registry with node classes."""
        self._nodes = {node.type: node for node in nodes}

    def node_types(self) -> set[str]:
        """Return the set of available node type ids."""
        return set(self._nodes.keys())

    def create(self, definition: PipelineNodeDefinition) -> PipelineNodeBase[Any]:
        """Instantiate a node from its definition."""
        node_cls = self._nodes.get(definition.type)
        if node_cls is None:
            raise ValueError(f"Unknown node type: {definition.type}")
        config = node_cls.config_model.model_validate(definition.config)
        return node_cls(config)

    def specs(self) -> list[NodeSpec]:
        """Return specs for all registered nodes."""
        return [node.spec() for node in self._nodes.values()]

    def get_spec(self, node_type: str) -> NodeSpec | None:
        """Return a node spec for the requested type."""
        node_cls = self._nodes.get(node_type)
        return node_cls.spec() if node_cls else None

    def get_node_class(self, node_type: str) -> type[PipelineNodeBase[Any]] | None:
        """Return the registered node class for the requested type."""
        return self._nodes.get(node_type)


def build_default_registry() -> NodeRegistry:
    """Return a freshly built registry containing all built-in nodes."""
    return NodeRegistry(
        [
            IngestionInputNode,
            DocumentParserNode,
            FileTypeRouterNode,
            ChunkerNode,
            TokenChunkerNode,
            SentenceChunkerNode,
            ParagraphChunkerNode,
            SemanticChunkerNode,
            EmbedderNode,
            VectorIndexerNode,
            Bm25IndexerNode,
            IndexerNode,
            PgvectorIndexerNode,
            IngestionOutputNode,
            RetrievalInputNode,
            VectorRetrieverNode,
            Bm25RetrieverNode,
            RRFusionNode,
            ResultLimitNode,
            PineconeRetrieverNode,
            PgvectorRetrieverNode,
            RerankerNode,
            RetrievalOutputNode,
        ]
    )


_default_registry: NodeRegistry | None = None


def default_registry() -> NodeRegistry:
    """Return the process-wide default node registry, building it once.

    The built-in node catalog is fixed (it's read from class attributes, not
    request state), so routes and services should call this instead of
    `build_default_registry()` to avoid re-instantiating every node class's
    spec on every request. `build_default_registry()` stays available for
    callers (mainly tests) that want a guaranteed-fresh instance.
    """
    global _default_registry
    if _default_registry is None:
        _default_registry = build_default_registry()
    return _default_registry
