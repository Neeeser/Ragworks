"""Definition-schema v1 -> v2 rewrite: variables own the pipeline inputs.

Split from `app/pipelines/upgrades.py` (the node/port vocabulary rewrite)
purely for module size. `migrate_variables_definition` is gated by the
*absence* of ``schema_version`` in the raw stored dict, never by shape alone:
argument objects on `retrieval.input` configs become input-source variables
with the node keeping only the name list; every fusion node gets a Result
Limit node inserted downstream carrying its old `top_k` config (fusion no
longer truncates, so behavior is preserved only with the explicit cut in
place); the old caller-facing `top_k` argument becomes `result_limit`; and
every retriever's fetch depth becomes an explicit config -- the
request-depth fallback is gone.
"""

from __future__ import annotations

from pydantic import ValidationError

from app.pipelines.defaults import DEFAULT_RESULT_LIMIT_VARIABLE
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.retrieval import (
    PgvectorRetrieverNode,
    PineconeRetrieverNode,
    VectorRetrieverNode,
)
from app.pipelines.nodes.retrieval_bm25 import Bm25RetrieverNode
from app.pipelines.result_limit_upgrades import (
    migrate_node_expressions,
    migrate_top_k_expression,
    migrate_variable,
    migrated_limit_name,
)
from app.pipelines.upgrades import unique_edge_id, unique_id
from app.pipelines.variables import PipelineInputArgument, PipelineVariable, VariableSource

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
        limit_id = unique_id(f"{node.id}-limit", taken_ids)
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
                id=unique_edge_id(f"edge-{node.id}-limit", edges),
                source=node.id,
                target=limit_id,
                source_port="items",
                target_port="items",
            )
        )
    return result_nodes, edges
