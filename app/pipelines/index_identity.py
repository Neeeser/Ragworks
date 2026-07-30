"""The index identity a store-bound node carries in its own config.

A node names the index it reads or writes, the same way it names its model:
identity is a property of the graph, because the index's width is decided by
the embedder sitting next to it. This module reads that identity back out —
for registration, so every index a definition names exists as a first-class
`RegisteredIndex` row — and converts legacy `{collection_id}` namespace
templates into checked expressions.

Pointing a node at a *slot* the collection fills instead is authored
deliberately, one node at a time, by writing an index variable into the
node's config (`{"$expr": "memories_index.name"}`). Nothing here derives
those: a definition with two dense stores has two indexes, and any rule that
folds them onto one shared variable silently merges two corpora into one.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.counting import Bm25CountNode, Bm25FacetNode
from app.pipelines.nodes.indexing import BaseIndexerNode, Bm25IndexerNode
from app.pipelines.nodes.retrieval import BaseRetrieverNode
from app.pipelines.nodes.retrieval_bm25 import Bm25RetrieverNode
from app.pipelines.registry import NodeRegistry
from app.pipelines.variables import EXPRESSION_KEY, expression_source
from app.schemas.enums import IndexBackend

_LEXICAL_NODE_TYPES = frozenset(
    {Bm25IndexerNode.type, Bm25RetrieverNode.type, Bm25CountNode.type, Bm25FacetNode.type}
)

_TEMPLATE_EXPRESSIONS = {
    "{collection_id}": "collection_id",
    "{collection_name}": "collection_name",
    "{user_id}": "user_id",
}


@dataclass(frozen=True)
class IndexIdentity:
    """One index a definition names literally."""

    backend: IndexBackend
    name: str
    vector_type: str
    dimension: int | None = None
    metric: str | None = None


def is_lexical_node(node_type: str) -> bool:
    """Return True for the BM25/lexical node family."""
    return node_type in _LEXICAL_NODE_TYPES


def store_bound_node(node_type: str, registry: NodeRegistry) -> bool:
    """Return True when a node carries index identity in its config."""
    if is_lexical_node(node_type):
        return True
    node_cls = registry.get_node_class(node_type)
    return node_cls is not None and issubclass(node_cls, (BaseIndexerNode, BaseRetrieverNode))


def collect_index_identities(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> list[IndexIdentity]:
    """Return every distinct index a definition names literally.

    Distinct by `(backend, name, vector_type)`, so two nodes reading and
    writing one index register one row while two stores holding different
    corpora register two. Nodes whose index is an expression are skipped:
    the index they resolve to is a per-binding answer, registered when the
    binding chooses it.
    """
    identities: dict[tuple[IndexBackend, str, str], IndexIdentity] = {}
    for node in definition.nodes:
        identity = _node_identity(node, registry)
        if identity is None:
            continue
        key = (identity.backend, identity.name, identity.vector_type)
        existing = identities.get(key)
        # An indexer states the parameters the index is created with; a
        # retriever only reads, so it never overwrites what one recorded.
        identities[key] = (
            identity
            if existing is None
            else IndexIdentity(
                backend=identity.backend,
                name=identity.name,
                vector_type=identity.vector_type,
                dimension=identity.dimension if identity.dimension is not None else existing.dimension,
                metric=identity.metric if identity.metric is not None else existing.metric,
            )
        )
    return list(identities.values())


def _node_identity(
    node: PipelineNodeDefinition,
    registry: NodeRegistry,
) -> IndexIdentity | None:
    """Read one node's literal index identity, or None when it has none."""
    if not store_bound_node(node.type, registry):
        return None
    config = node.config or {}
    name = config.get("index_name")
    if not isinstance(name, str) or not name or expression_source(name) is not None:
        return None
    backend = _node_backend(node, registry)
    if backend is None:
        return None
    dimension = config.get("dimension")
    metric = config.get("metric")
    return IndexIdentity(
        backend=backend,
        name=name,
        vector_type="sparse" if is_lexical_node(node.type) else "dense",
        dimension=dimension if isinstance(dimension, int) else None,
        metric=metric if isinstance(metric, str) else None,
    )


def _node_backend(node: PipelineNodeDefinition, registry: NodeRegistry) -> IndexBackend | None:
    """Resolve a node's literal backend from its config or pinned class."""
    raw = (node.config or {}).get("backend")
    if isinstance(raw, str):
        try:
            return IndexBackend(raw)
        except ValueError:
            return None
    node_cls = registry.get_node_class(node.type)
    pinned = getattr(node_cls, "backend", None)
    return pinned if isinstance(pinned, IndexBackend) else None


def template_to_expression(value: str) -> str | None:
    """Return the expression equivalent of a `{placeholder}` template.

    Returns None when the value holds no placeholder, so a plain literal is
    left exactly as it is rather than wrapped in a needless expression.
    """
    if not any(token in value for token in _TEMPLATE_EXPRESSIONS):
        return None
    parts: list[str] = []
    remaining = value
    while remaining:
        hit = min(
            (
                (remaining.index(token), token)
                for token in _TEMPLATE_EXPRESSIONS
                if token in remaining
            ),
            default=None,
        )
        if hit is None:
            parts.append(_quote(remaining))
            break
        position, token = hit
        if position:
            parts.append(_quote(remaining[:position]))
        parts.append(_TEMPLATE_EXPRESSIONS[token])
        remaining = remaining[position + len(token) :]
    return " + ".join(parts) if parts else _quote(value)


def _quote(literal: str) -> str:
    """Render a string literal for the expression grammar."""
    return "'" + literal.replace("\\", "\\\\").replace("'", "\\'") + "'"


def rewrite_namespace_templates(definition: PipelineDefinition) -> PipelineDefinition:
    """Convert `{collection_id}`-style namespaces into checked expressions.

    The blind string-replace it replaces let a typo'd `{colection_id}` land
    in a namespace as literal text; as an expression the same typo is an
    unknown-variable error the editor reports before a save.
    """
    nodes = [_rewrite_namespace(node) for node in definition.nodes]
    if all(new is old for new, old in zip(nodes, definition.nodes, strict=True)):
        return definition
    return definition.model_copy(update={"nodes": nodes})


def _rewrite_namespace(node: PipelineNodeDefinition) -> PipelineNodeDefinition:
    """Convert one node's namespace template, or return it untouched."""
    config = node.config or {}
    namespace = config.get("namespace")
    if not isinstance(namespace, str):
        return node
    expression = template_to_expression(namespace)
    if expression is None:
        return node
    return node.model_copy(update={"config": {**config, "namespace": {EXPRESSION_KEY: expression}}})
