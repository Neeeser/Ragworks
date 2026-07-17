"""One-way upgrades applied to stored pipeline definitions.

Node type ids are permanent, but the catalog moves on: the backend-pinned
indexer/retriever variants were superseded by the unified ``indexer.vector``/
``retriever.vector`` nodes (backend selected in config), and the no-op
``chat.settings`` node was removed outright (the chat model is a session-level
choice made in the chat UI). `upgrade_definition` rewrites a stored definition
to the current vocabulary; the startup migration applies it to every stored
version in place -- a mechanical rewrite, not a new revision.

`migrate_variables_definition` is the definition-schema v1 -> v2 rewrite
(gated by the *absence* of ``schema_version`` in the raw stored dict, never by
shape alone): argument objects on `retrieval.input` configs become
input-source variables with the node keeping only the name list, and every
fusion node gets a Top-N node inserted downstream carrying its old `top_k`
config -- fusion no longer truncates, so behavior is preserved only with the
explicit cut in place.
"""

from __future__ import annotations

from pydantic import ValidationError

from app.pipelines.defaults import DEFAULT_TOP_K_VARIABLE
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.indexing import VectorIndexerNode, default_index_name
from app.pipelines.nodes.indexing_legacy import IndexerNode, PgvectorIndexerNode
from app.pipelines.nodes.limiting import LimitNode
from app.pipelines.nodes.retrieval import (
    PgvectorRetrieverNode,
    PineconeRetrieverNode,
    VectorRetrieverNode,
)
from app.pipelines.variables import PipelineInputArgument, PipelineVariable, VariableSource
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


RETRIEVAL_INPUT_TYPE = "retrieval.input"
FUSION_TYPE_PREFIX = "fusion."


def migrate_variables_definition(definition: PipelineDefinition) -> PipelineDefinition:
    """Rewrite a v1 definition to the variables-own-inputs shape (v2).

    Always returns a copy: the caller re-dumps it, which stamps the current
    ``schema_version`` so the migration never reconsiders the row.
    """
    variables = [variable.model_copy(deep=True) for variable in definition.variables]
    nodes = [_migrate_input_node(node, variables) for node in definition.nodes]
    nodes, edges = _insert_fusion_limits(nodes, list(definition.edges))
    nodes = declare_default_top_k(nodes, variables)
    return definition.model_copy(update={"nodes": nodes, "edges": edges, "variables": variables})


def declare_default_top_k(
    nodes: list[PipelineNodeDefinition],
    variables: list[PipelineVariable],
) -> list[PipelineNodeDefinition]:
    """Make the historical implicit top_k contract explicit on no-input pipelines.

    A pre-variables retrieval definition declared nothing: the chat tool
    schema fell back to the hardcoded ``top_k`` (integer, 1-10, default 5)
    and fusion cut to the requested depth invisibly. Rewriting it to declare
    the scaffold's ``top_k`` input variable, accept it on the input node, and
    point unset Top-N cuts at ``{"$expr": "top_k"}`` keeps that contract
    byte-for-byte while making it visible and editable. Definitions that
    already declare any input variable are left alone. Appends to
    `variables` in place; returns the rewritten node list.
    """
    input_nodes = [node for node in nodes if node.type == RETRIEVAL_INPUT_TYPE]
    if not input_nodes:
        return nodes
    if any(variable.source is VariableSource.INPUT for variable in variables):
        return nodes
    if any(variable.name == DEFAULT_TOP_K_VARIABLE.name for variable in variables):
        return nodes
    variables.append(DEFAULT_TOP_K_VARIABLE.model_copy(deep=True))
    rewritten: list[PipelineNodeDefinition] = []
    for node in nodes:
        if node.type == RETRIEVAL_INPUT_TYPE:
            rewritten.append(
                node.model_copy(
                    update={
                        "config": {**node.config, "arguments": [DEFAULT_TOP_K_VARIABLE.name]}
                    }
                )
            )
        elif node.type == LimitNode.type and node.config.get("top_n") is None:
            rewritten.append(
                node.model_copy(
                    update={
                        "config": {
                            **node.config,
                            "top_n": {"$expr": DEFAULT_TOP_K_VARIABLE.name},
                        }
                    }
                )
            )
        else:
            rewritten.append(node)
    return rewritten


def _migrate_input_node(
    node: PipelineNodeDefinition,
    variables: list[PipelineVariable],
) -> PipelineNodeDefinition:
    """Move a retrieval.input node's argument objects into `variables`.

    The node keeps only the accepted names. Entries that don't parse as the
    legacy argument shape (including already-migrated plain strings) pass
    through as names so a partially-new config is never corrupted.
    """
    if node.type != RETRIEVAL_INPUT_TYPE:
        return node
    raw = node.config.get("arguments")
    if not isinstance(raw, list) or not any(isinstance(entry, dict) for entry in raw):
        return node
    names: list[str] = []
    for entry in raw:
        if isinstance(entry, str):
            names.append(entry)
            continue
        try:
            argument = PipelineInputArgument.model_validate(entry)
        except ValidationError:
            continue
        names.append(argument.name)
        variables.append(
            PipelineVariable(
                name=argument.name,
                type=argument.type,
                source=VariableSource.INPUT,
                description=argument.description,
                value=None if argument.required else argument.default,
                minimum=argument.minimum,
                maximum=argument.maximum,
                choices=list(argument.choices),
                expose_to_llm=argument.expose_to_llm,
            )
        )
    return node.model_copy(update={"config": {**node.config, "arguments": names}})


def _insert_fusion_limits(
    nodes: list[PipelineNodeDefinition],
    edges: list[PipelineEdgeDefinition],
) -> tuple[list[PipelineNodeDefinition], list[PipelineEdgeDefinition]]:
    """Insert a Top-N node after every fusion node, carrying its old cut.

    v1 fusion truncated (explicit `top_k` config, else the run's requested
    top_k); v2 fusion emits everything. The inserted Top-N preserves each
    pipeline's exact behavior: the fusion's `top_k` value (literal or
    expression) when set, else unset -- which is the requested-top_k default.
    """
    taken_ids = {node.id for node in nodes}
    result_nodes: list[PipelineNodeDefinition] = []
    for node in nodes:
        if not node.type.startswith(FUSION_TYPE_PREFIX):
            result_nodes.append(node)
            continue
        config = {key: value for key, value in node.config.items() if key != "top_k"}
        result_nodes.append(node.model_copy(update={"config": config}))
        limit_id = _unique_id(f"{node.id}-limit", taken_ids)
        limit_config = (
            {"top_n": node.config["top_k"]} if node.config.get("top_k") is not None else {}
        )
        result_nodes.append(
            PipelineNodeDefinition(
                id=limit_id,
                type=LimitNode.type,
                name="Top-N",
                config=limit_config,
            )
        )
        edges = [
            edge.model_copy(update={"source": limit_id}) if edge.source == node.id else edge
            for edge in edges
        ]
        edges.append(
            PipelineEdgeDefinition(
                id=_unique_edge_id(f"edge-{node.id}-limit", edges),
                source=node.id,
                target=limit_id,
                source_port="results",
                target_port="results",
            )
        )
    return result_nodes, edges


def _unique_id(base: str, taken: set[str]) -> str:
    """Return `base` (or a numbered variant) not present in `taken`, claiming it."""
    candidate = base
    suffix = 1
    while candidate in taken:
        suffix += 1
        candidate = f"{base}-{suffix}"
    taken.add(candidate)
    return candidate


def _unique_edge_id(base: str, edges: list[PipelineEdgeDefinition]) -> str:
    """Return `base` (or a numbered variant) unused by any edge."""
    taken = {edge.id for edge in edges}
    candidate = base
    suffix = 1
    while candidate in taken:
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate
