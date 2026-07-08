"""Structural diffing between two pipeline definitions.

Powers two behaviors: rejecting saves that change nothing (`PipelineService.
update_pipeline`), and the per-revision change list the editor shows for each
version. Layout (node positions / viewport) is deliberately a single
``layout`` change kind so callers can treat "the user only dragged nodes
around" differently from behavioral edits.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from app.pipelines.definition import PipelineDefinition, PipelineEdgeDefinition

ChangeKind = Literal[
    "created",
    "node_added",
    "node_removed",
    "node_renamed",
    "node_config",
    "edge_added",
    "edge_removed",
    "layout",
]

_VALUE_PREVIEW_LIMIT = 48

# Kinds that do not affect what the pipeline does when it runs.
LAYOUT_KINDS: frozenset[str] = frozenset({"layout"})


class DefinitionChange(BaseModel):
    """One human-readable change between two pipeline definitions."""

    kind: ChangeKind
    summary: str


def _format_value(value: Any) -> str:
    """Render a config value compactly for a change summary."""
    text = value if isinstance(value, str) else repr(value)
    if len(text) > _VALUE_PREVIEW_LIMIT:
        text = f"{text[: _VALUE_PREVIEW_LIMIT - 1]}…"
    return text


def _edge_key(edge: PipelineEdgeDefinition) -> tuple[str, str | None, str, str | None]:
    """Identify an edge by its endpoints, not its (client-generated) id."""
    return (edge.source, edge.source_port, edge.target, edge.target_port)


def _config_changes(
    node_name: str,
    old_config: dict[str, Any],
    new_config: dict[str, Any],
) -> list[DefinitionChange]:
    """Describe per-key config differences on one node."""
    changes: list[DefinitionChange] = []
    for key in sorted(set(old_config) | set(new_config)):
        if key in old_config and key not in new_config:
            changes.append(
                DefinitionChange(kind="node_config", summary=f"{node_name}: cleared {key}")
            )
        elif key not in old_config:
            changes.append(
                DefinitionChange(
                    kind="node_config",
                    summary=f"{node_name}: {key} set to {_format_value(new_config[key])}",
                )
            )
        elif old_config[key] != new_config[key]:
            changes.append(
                DefinitionChange(
                    kind="node_config",
                    summary=(
                        f"{node_name}: {key} {_format_value(old_config[key])} → "
                        f"{_format_value(new_config[key])}"
                    ),
                )
            )
    return changes


def _node_changes(
    old: PipelineDefinition,
    new: PipelineDefinition,
) -> tuple[list[DefinitionChange], bool]:
    """Describe node-level differences; the bool reports position-only moves."""
    changes: list[DefinitionChange] = []
    old_nodes = old.node_map()
    new_nodes = new.node_map()

    for node_id, node in new_nodes.items():
        if node_id not in old_nodes:
            changes.append(
                DefinitionChange(kind="node_added", summary=f"Added {node.name} ({node.type})")
            )
    for node_id, node in old_nodes.items():
        if node_id not in new_nodes:
            changes.append(
                DefinitionChange(kind="node_removed", summary=f"Removed {node.name} ({node.type})")
            )

    layout_changed = False
    for node_id, node in new_nodes.items():
        previous = old_nodes.get(node_id)
        if previous is None:
            continue
        if previous.type != node.type:
            changes.append(
                DefinitionChange(
                    kind="node_config",
                    summary=f"{node.name}: type {previous.type} → {node.type}",
                )
            )
        if previous.name != node.name:
            changes.append(
                DefinitionChange(
                    kind="node_renamed",
                    summary=f"Renamed '{previous.name}' to '{node.name}'",
                )
            )
        changes.extend(_config_changes(node.name, previous.config, node.config))
        if previous.position != node.position:
            layout_changed = True
    return changes, layout_changed


def _edge_changes(
    old: PipelineDefinition,
    new: PipelineDefinition,
) -> list[DefinitionChange]:
    """Describe added/removed connections, named by their endpoints' labels."""

    def node_label(definition: PipelineDefinition, node_id: str) -> str:
        node = definition.node_map().get(node_id)
        return node.name if node else node_id

    changes: list[DefinitionChange] = []
    old_edges = {_edge_key(edge) for edge in old.edges}
    new_edges = {_edge_key(edge) for edge in new.edges}
    for key in sorted(new_edges - old_edges, key=str):
        changes.append(
            DefinitionChange(
                kind="edge_added",
                summary=f"Connected {node_label(new, key[0])} → {node_label(new, key[2])}",
            )
        )
    for key in sorted(old_edges - new_edges, key=str):
        changes.append(
            DefinitionChange(
                kind="edge_removed",
                summary=f"Disconnected {node_label(old, key[0])} → {node_label(old, key[2])}",
            )
        )
    return changes


def diff_definitions(
    old: PipelineDefinition,
    new: PipelineDefinition,
) -> list[DefinitionChange]:
    """Return the changes that turn `old` into `new`, most significant first."""
    changes, layout_changed = _node_changes(old, new)
    changes.extend(_edge_changes(old, new))
    if layout_changed:
        changes.append(DefinitionChange(kind="layout", summary="Layout updated"))
    return changes


def material_changes(changes: list[DefinitionChange]) -> list[DefinitionChange]:
    """Return only the changes that affect runtime behavior (drop layout-only)."""
    return [change for change in changes if change.kind not in LAYOUT_KINDS]
