"""Rewriting literal index identity into binding-source index variables.

The v2 -> v3 definition migration, and the same shaping the default-pipeline
scaffolder uses. A store-bound node's `backend`/`index_name` stop being
literals and become expressions over an index variable, so a collection
binding can repoint the pipeline without the definition changing.

The rewrite is behavior-preserving by construction: each variable's *default*
is the literal the node already carried, so a definition that resolved to
`docs-main` on pgvector still resolves to exactly that until someone chooses
otherwise. Collection placeholders move the same way — `col-{collection_id}`
becomes `'col-' + collection_id`, the same string through a checked path.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.counting import Bm25CountNode, Bm25FacetNode
from app.pipelines.nodes.indexing import BaseIndexerNode, Bm25IndexerNode
from app.pipelines.nodes.retrieval import BaseRetrieverNode, Bm25RetrieverNode
from app.pipelines.registry import NodeRegistry
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.pipelines.variables import (
    EXPRESSION_KEY,
    PipelineVariable,
    VariableSource,
    VariableType,
    expression_source,
)
from app.schemas.enums import IndexBackend

DENSE_INDEX_VARIABLE = "primary_index"
SPARSE_INDEX_VARIABLE = "bm25_index"

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
    """One index a definition referenced literally, before the rewrite."""

    backend: IndexBackend
    name: str
    vector_type: str
    dimension: int | None = None
    metric: str | None = None


@dataclass(frozen=True)
class RewrittenDefinition:
    """A rewritten definition and the index identities it now names."""

    definition: PipelineDefinition
    identities: dict[str, IndexIdentity]
    changed: bool


def is_lexical_node(node_type: str) -> bool:
    """Return True for the BM25/lexical node family."""
    return node_type in _LEXICAL_NODE_TYPES


def store_bound_node(node_type: str, registry: NodeRegistry) -> bool:
    """Return True when a node carries index identity in its config."""
    if is_lexical_node(node_type):
        return True
    node_cls = registry.get_node_class(node_type)
    return node_cls is not None and issubclass(node_cls, (BaseIndexerNode, BaseRetrieverNode))


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


def rewrite_index_identity(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    *,
    index_ids: dict[str, UUID] | None = None,
) -> RewrittenDefinition:
    """Move literal index identity onto binding-source index variables.

    `index_ids` pins the registry row each variable defaults to; callers
    without rows yet (the migration's first pass) let ids be generated and
    register them afterwards.
    """
    identities = _collect_identities(definition, registry)
    if not identities:
        return RewrittenDefinition(definition=definition, identities={}, changed=False)
    ids = index_ids or {}
    variables = [
        variable
        for variable in definition.variables
        if variable.name not in identities
    ]
    for name, identity in identities.items():
        variables.append(
            PipelineVariable(
                name=name,
                type=VariableType.INDEX,
                source=VariableSource.BINDING,
                description=(
                    "Lexical (BM25) index this pipeline uses"
                    if identity.vector_type == "sparse"
                    else "Vector index this pipeline uses"
                ),
                value={
                    "index_id": str(ids.get(name, uuid4())),
                    "backend": identity.backend.value,
                    "name": identity.name,
                },
            )
        )
    nodes = [_rewrite_node(node, registry, identities) for node in definition.nodes]
    return RewrittenDefinition(
        definition=definition.model_copy(update={"nodes": nodes, "variables": variables}),
        identities=identities,
        changed=True,
    )


def _variable_for(node_type: str) -> str:
    """Return the index variable a node's identity belongs on."""
    return SPARSE_INDEX_VARIABLE if is_lexical_node(node_type) else DENSE_INDEX_VARIABLE


def _collect_identities(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> dict[str, IndexIdentity]:
    """Gather the literal index identity each variable will carry."""
    identities: dict[str, IndexIdentity] = {}
    for node in definition.nodes:
        if not store_bound_node(node.type, registry):
            continue
        config = node.config or {}
        name = config.get("index_name")
        if not isinstance(name, str) or not name or expression_source(name) is not None:
            continue
        backend = _node_backend(node, registry)
        if backend is None:
            continue
        variable = _variable_for(node.type)
        existing = identities.get(variable)
        dimension = config.get("dimension")
        metric = config.get("metric")
        identities[variable] = IndexIdentity(
            backend=backend,
            name=name,
            vector_type="sparse" if is_lexical_node(node.type) else "dense",
            # An indexer states the parameters the index is created with; a
            # retriever only reads, so it never overwrites what one recorded.
            dimension=(
                dimension
                if isinstance(dimension, int)
                else (existing.dimension if existing else None)
            ),
            metric=metric if isinstance(metric, str) else (existing.metric if existing else None),
        )
    return identities


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


def _rewrite_node(
    node: PipelineNodeDefinition,
    registry: NodeRegistry,
    identities: dict[str, IndexIdentity],
) -> PipelineNodeDefinition:
    """Point one node's identity fields at its index variable."""
    config = dict(node.config or {})
    changed = False
    if store_bound_node(node.type, registry):
        variable = _variable_for(node.type)
        if variable in identities and isinstance(config.get("index_name"), str):
            config["index_name"] = {EXPRESSION_KEY: f"{variable}.name"}
            if "backend" in config:
                config["backend"] = {EXPRESSION_KEY: f"{variable}.backend"}
            changed = True
    namespace = config.get("namespace")
    if isinstance(namespace, str):
        expression = template_to_expression(namespace)
        if expression is not None:
            config["namespace"] = {EXPRESSION_KEY: expression}
            changed = True
    return node.model_copy(update={"config": config}) if changed else node


def default_namespace_expression() -> str:
    """The expression form of the default per-collection namespace."""
    expression = template_to_expression(DEFAULT_NAMESPACE_TEMPLATE)
    if expression is None:  # pragma: no cover - the default always templates
        raise ValueError("The default namespace template has no placeholder.")
    return expression
