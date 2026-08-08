"""Structural checks over a definition's nodes, edges, and ports.

Every finding names the node whose editor fixes it, because an unattributed
error can only be printed as a sentence: the canvas cannot mark it, and the
surfaces that group findings by node (the save gate, the create wizard) drop
it into a pipeline-level bucket that says nothing about where to look.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.node_ports import resolve_output_ports
from app.pipelines.ports import compatible_kinds
from app.pipelines.registry import NodeRegistry


def graph_structure_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Return every structural error in the definition, node-attributed."""
    node_ids = {node.id for node in definition.nodes}
    node_map = definition.node_map()
    issues = [
        *_node_identity_issues(definition, node_ids, registry),
        *_edge_endpoint_issues(definition, node_ids),
        *_edge_port_issues(definition, node_map, registry),
        *_port_fanin_issues(definition, node_map, registry),
        *_required_input_issues(definition, registry),
    ]
    if has_cycle(definition):
        issues.append(
            PipelineValidationIssue(
                message="Pipeline contains at least one cycle.",
                code="graph.cycle",
            )
        )
    return issues


def has_cycle(definition: PipelineDefinition) -> bool:
    """Detect cycles using depth-first traversal."""
    adjacency: dict[str, list[str]] = {node.id: [] for node in definition.nodes}
    for edge in definition.edges:
        if edge.source in adjacency:
            adjacency[edge.source].append(edge.target)

    visited: set[str] = set()
    visiting: set[str] = set()

    def dfs(node_id: str) -> bool:
        if node_id in visiting:
            return True
        if node_id in visited:
            return False
        visiting.add(node_id)
        for neighbor in adjacency.get(node_id, []):
            if dfs(neighbor):
                return True
        visiting.remove(node_id)
        visited.add(node_id)
        return False

    return any(dfs(node_id) for node_id in adjacency)


def _node_identity_issues(
    definition: PipelineDefinition,
    node_ids: set[str],
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Flag duplicate node ids and node types missing from the registry."""
    issues: list[PipelineValidationIssue] = []
    if len(node_ids) != len(definition.nodes):
        # No single node owns the collision, so this one stays pipeline-level.
        issues.append(
            PipelineValidationIssue(
                message="Duplicate node ids detected.",
                code="graph.duplicate_node_id",
            )
        )
    known_types = registry.node_types()
    issues.extend(
        PipelineValidationIssue(
            message=f"Unknown node type '{node.type}' for node '{node.id}'.",
            code="graph.unknown_node_type",
            node_id=node.id,
        )
        for node in definition.nodes
        if node.type not in known_types
    )
    return issues


def _edge_endpoint_issues(
    definition: PipelineDefinition,
    node_ids: set[str],
) -> list[PipelineValidationIssue]:
    """Flag edges whose source or target node id doesn't exist.

    Attributed to whichever end does exist — that is the node holding the
    dangling wire, and the only one a user can open.
    """
    issues: list[PipelineValidationIssue] = []
    for edge in definition.edges:
        if edge.source not in node_ids:
            issues.append(
                PipelineValidationIssue(
                    message=f"Edge '{edge.id}' has unknown source '{edge.source}'.",
                    code="graph.edge_endpoint",
                    node_id=edge.target if edge.target in node_ids else None,
                )
            )
        if edge.target not in node_ids:
            issues.append(
                PipelineValidationIssue(
                    message=f"Edge '{edge.id}' has unknown target '{edge.target}'.",
                    code="graph.edge_endpoint",
                    node_id=edge.source if edge.source in node_ids else None,
                )
            )
    return issues


def _edge_port_issues(
    definition: PipelineDefinition,
    node_map: dict[str, PipelineNodeDefinition],
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Flag edges referencing missing ports or connecting incompatible types."""
    issues: list[PipelineValidationIssue] = []
    for edge in definition.edges:
        source_def = node_map.get(edge.source)
        target_def = node_map.get(edge.target)
        source_spec = registry.get_spec(source_def.type) if source_def else None
        target_spec = registry.get_spec(target_def.type) if target_def else None
        source_port = None
        target_port = None
        if source_spec and source_def and edge.source_port:
            source_port = next(
                (
                    port
                    for port in resolve_output_ports(
                        source_spec.output_ports, source_spec.dynamic_output_ports, source_def
                    )
                    if port.key == edge.source_port
                ),
                None,
            )
            if source_port is None:
                issues.append(
                    PipelineValidationIssue(
                        message=(
                            f"Edge '{edge.id}' references missing output port "
                            f"'{edge.source_port}' on '{edge.source}'."
                        ),
                        code="graph.edge_port",
                        node_id=edge.source,
                    )
                )
        if target_spec and edge.target_port:
            target_port = next(
                (port for port in target_spec.input_ports if port.key == edge.target_port),
                None,
            )
            if target_port is None:
                issues.append(
                    PipelineValidationIssue(
                        message=(
                            f"Edge '{edge.id}' references missing input port "
                            f"'{edge.target_port}' on '{edge.target}'."
                        ),
                        code="graph.edge_port",
                        node_id=edge.target,
                    )
                )
        if (
            source_port
            and target_port
            and not compatible_kinds(source_port.data_type, target_port.data_type)
        ):
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Edge '{edge.id}' connects incompatible port types "
                        f"'{source_port.data_type}' -> '{target_port.data_type}'."
                    ),
                    code="graph.port_types",
                    # The receiving node is where the mismatch is visible: it is
                    # the one whose input cannot read what arrives.
                    node_id=edge.target,
                )
            )
    return issues


def _port_fanin_issues(
    definition: PipelineDefinition,
    node_map: dict[str, PipelineNodeDefinition],
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Flag multiple edges into an input port unless it accepts many.

    Without this check a second edge into a single-value port would silently
    overwrite the first at execution time.
    """
    issues: list[PipelineValidationIssue] = []
    counts: dict[tuple[str, str], int] = {}
    for edge in definition.edges:
        key = (edge.target, edge.target_port or "default")
        counts[key] = counts.get(key, 0) + 1
    for (target, port_key), count in counts.items():
        if count < 2:
            continue
        target_def = node_map.get(target)
        spec = registry.get_spec(target_def.type) if target_def else None
        if spec is None:
            continue
        port = next((p for p in spec.input_ports if p.key == port_key), None)
        if port is not None and not port.accepts_many:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Node '{target}' input port '{port_key}' has {count} incoming "
                        "edges but accepts only one."
                    ),
                    code="graph.port_fanin",
                    node_id=target,
                )
            )
    return issues


def _required_input_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Flag nodes missing inbound edges for their required input ports."""
    issues: list[PipelineValidationIssue] = []
    incoming = definition.incoming_edges()
    for node in definition.nodes:
        spec = registry.get_spec(node.type)
        if not spec:
            continue
        required_inputs = {port.key for port in spec.input_ports if port.required}
        inbound_ports = {edge.target_port or "default" for edge in incoming.get(node.id, [])}
        missing_ports = required_inputs - inbound_ports
        if missing_ports:
            missing_list = ", ".join(sorted(missing_ports))
            issues.append(
                PipelineValidationIssue(
                    message=f"Node '{node.id}' missing inbound edges for: {missing_list}.",
                    code="graph.required_input",
                    node_id=node.id,
                )
            )
    return issues
