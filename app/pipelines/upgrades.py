"""One-way upgrades applied to stored pipeline definitions.

Node type ids are normally permanent, but the catalog has had explicit one-way
transitions: backend-pinned indexer/retriever variants were superseded by the
unified ``indexer.vector``/``retriever.vector`` nodes, the no-op
``chat.settings`` node was removed, the local ``reranker.cross_encoder`` node
was retired, and this feature branch briefly persisted ``limit.top_n`` before
settling on ``limit.results``. `upgrade_definition` rewrites those stored
definitions to the current vocabulary; startup applies the mechanical rewrite
to every stored version in place, not as a new revision.

`migrate_variables_definition` is the definition-schema v1 -> v2 rewrite
(gated by the *absence* of ``schema_version`` in the raw stored dict, never by
shape alone): argument objects on `retrieval.input` configs become
input-source variables with the node keeping only the name list; every
fusion node gets a Result Limit node inserted downstream carrying its old `top_k`
config (fusion no longer truncates, so behavior is preserved only with the
explicit cut in place); the old caller-facing `top_k` argument becomes
`result_limit`; and every retriever's fetch depth
becomes an explicit config -- the request-depth fallback is gone.
"""

from __future__ import annotations

from pydantic import ValidationError

from app.pipelines.defaults import DEFAULT_RESULT_LIMIT_VARIABLE
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.indexing import VectorIndexerNode, default_index_name
from app.pipelines.nodes.indexing_legacy import IndexerNode, PgvectorIndexerNode
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.retrieval import (
    Bm25RetrieverNode,
    PgvectorRetrieverNode,
    PineconeRetrieverNode,
    VectorRetrieverNode,
)
from app.pipelines.result_limit_upgrades import (
    migrate_input_argument_names,
    migrate_node_expressions,
    migrate_top_k_expression,
    migrate_variable,
    migrated_limit_name,
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
LEGACY_RERANKER_TYPE = "reranker.cross_encoder"
LEGACY_RESULT_LIMIT_TYPE = "limit.top_n"


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
        kept_edges.append(edge)
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
            edge
            for edge in rewritten
            if edge.source != node_id and edge.target != node_id
        ]
        for inbound in incoming:
            for outbound in outgoing:
                rewritten.append(
                    PipelineEdgeDefinition(
                        id=_unique_edge_id(
                            f"edge-{inbound.source}-{outbound.target}", rewritten
                        ),
                        source=inbound.source,
                        target=outbound.target,
                        source_port=inbound.source_port,
                        target_port=outbound.target_port,
                    )
                )
    return rewritten


RETRIEVAL_INPUT_TYPE = "retrieval.input"
FUSION_TYPE_PREFIX = "fusion."


def migrate_variables_definition(definition: PipelineDefinition) -> PipelineDefinition:
    """Rewrite a v1 definition to the variables-own-inputs shape (v2).

    Always returns a copy: the caller re-dumps it, which stamps the current
    ``schema_version`` so the migration never reconsiders the row.
    """
    variables = [migrate_variable(variable) for variable in definition.variables]
    nodes = [_migrate_input_node(node, variables) for node in definition.nodes]
    nodes = [migrate_node_expressions(node) for node in nodes]
    nodes, edges = _insert_fusion_limits(nodes, list(definition.edges))
    nodes = declare_default_result_limit(nodes, variables)
    nodes = fill_retriever_top_k(nodes, variables)
    return definition.model_copy(update={"nodes": nodes, "edges": edges, "variables": variables})


def declare_default_result_limit(
    nodes: list[PipelineNodeDefinition],
    variables: list[PipelineVariable],
) -> list[PipelineNodeDefinition]:
    """Make the historical implicit result cap explicit on no-input pipelines.

    A pre-variables retrieval definition declared nothing: the chat tool
    schema fell back to a hardcoded integer limit (1-10, default 5)
    and fusion cut to the requested depth invisibly. Rewriting it to declare
    the scaffold's ``result_limit`` input variable, accept it on the input
    node, and point unset Result Limit nodes at it. Definitions that
    already declare any input variable are left alone. Appends to
    `variables` in place; returns the rewritten node list.
    """
    input_nodes = [node for node in nodes if node.type == RETRIEVAL_INPUT_TYPE]
    if not input_nodes:
        return nodes
    if any(variable.source is VariableSource.INPUT for variable in variables):
        return nodes
    if any(variable.name == DEFAULT_RESULT_LIMIT_VARIABLE.name for variable in variables):
        return nodes
    variables.append(DEFAULT_RESULT_LIMIT_VARIABLE.model_copy(deep=True))
    rewritten: list[PipelineNodeDefinition] = []
    for node in nodes:
        if node.type == RETRIEVAL_INPUT_TYPE:
            rewritten.append(
                node.model_copy(
                    update={
                        "config": {
                            **node.config,
                            "arguments": [DEFAULT_RESULT_LIMIT_VARIABLE.name],
                        }
                    }
                )
            )
        elif node.type == ResultLimitNode.type and node.config.get("max_results") is None:
            rewritten.append(
                node.model_copy(
                    update={
                        "config": {
                            **node.config,
                            "max_results": {"$expr": DEFAULT_RESULT_LIMIT_VARIABLE.name},
                        }
                    }
                )
            )
        else:
            rewritten.append(node)
    return rewritten


RETRIEVER_NODE_TYPES = frozenset(
    {
        VectorRetrieverNode.type,
        Bm25RetrieverNode.type,
        PineconeRetrieverNode.type,
        PgvectorRetrieverNode.type,
    }
)


def fill_retriever_top_k(
    nodes: list[PipelineNodeDefinition],
    variables: list[PipelineVariable],
) -> list[PipelineNodeDefinition]:
    """Give every retriever with no fetch depth an explicit `top_k`.

    v1 retrievers silently fell back to the request's depth; v2 makes the
    depth a required, visible config. Behavior-preserving fill: the `top_k`
    result-limit variable when the definition declares one (guaranteed for
    pre-variables rows by `declare_default_result_limit`), else the literal default —
    that case can only be a definition whose declared inputs never included
    a depth, where the caller couldn't steer it anyway.
    """
    has_result_limit_variable = any(
        variable.name == DEFAULT_RESULT_LIMIT_VARIABLE.name for variable in variables
    )
    fill: object = (
        {"$expr": DEFAULT_RESULT_LIMIT_VARIABLE.name}
        if has_result_limit_variable
        else DEFAULT_RESULT_LIMIT_VARIABLE.value
    )
    return [
        node.model_copy(update={"config": {**node.config, "top_k": fill}})
        if node.type in RETRIEVER_NODE_TYPES and node.config.get("top_k") is None
        else node
        for node in nodes
    ]


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
    if not isinstance(raw, list):
        return node
    names: list[str] = []
    for entry in raw:
        if isinstance(entry, str):
            names.append(migrated_limit_name(entry))
            continue
        try:
            argument = PipelineInputArgument.model_validate(entry)
        except ValidationError:
            continue
        migrated_name = migrated_limit_name(argument.name)
        names.append(migrated_name)
        variables.append(
            PipelineVariable(
                name=migrated_name,
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
    """Insert a Result Limit node after every fusion node, carrying its old cut.

    v1 fusion truncated (explicit `top_k` config, else the run's requested
    top_k); v2 fusion emits everything. The inserted Result Limit preserves each
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
            {"max_results": migrate_top_k_expression(node.config["top_k"])}
            if node.config.get("top_k") is not None
            else {}
        )
        result_nodes.append(
            PipelineNodeDefinition(
                id=limit_id,
                type=ResultLimitNode.type,
                name="Result Limit",
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
