"""What each node's own config makes it destroy.

A node that rewrites content unconditionally declares `removes` on its
output port. A node whose rewriting depends on how it is configured — an
LLM shell whose output fields may write an item's text or only add
metadata beside it — answers `removes_for_node` instead, and this module
collects those answers into the overrides the graph projection applies
(`app/pipelines/validation.py`). It is the `removes` counterpart of
`model_modalities.resolve_model_modalities`, which resolves the `accepts`
a node's model widens.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition
from app.pipelines.registry import NodeRegistry

#: What each `(node id, output port key)` destroys once its config is read.
RemovesOverrides = dict[tuple[str, str], tuple[str, ...]]


def resolve_config_removes(
    definition: PipelineDefinition, registry: NodeRegistry
) -> RemovesOverrides:
    """Ask every node what its own config makes it destroy.

    A node whose rewriting is unconditional answers nothing here, so the
    projection leaves the declaration on its port alone.
    """
    overrides: RemovesOverrides = {}
    for node in definition.nodes:
        node_class = registry.get_node_class(node.type)
        if node_class is None:
            continue
        for port_key, removes in node_class.removes_for_node(node.config or {}).items():
            overrides[node.id, port_key] = removes
    return overrides
