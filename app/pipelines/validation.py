"""Validation of pipeline definitions against a node registry."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.ports import compatible
from app.pipelines.registry import NodeRegistry


class PipelineValidationResult(BaseModel):
    """Validation output for pipeline definitions."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PipelineValidator:
    """Validation helper for pipeline definitions."""

    def __init__(self, registry: NodeRegistry) -> None:
        """Initialize the validator with a node registry."""
        self._registry = registry

    def validate(self, definition: PipelineDefinition) -> PipelineValidationResult:
        """Validate the pipeline definition and return any errors."""
        node_ids = {node.id for node in definition.nodes}
        node_map = definition.node_map()

        errors: list[str] = []
        errors.extend(self._check_node_identity(definition, node_ids))
        errors.extend(self._check_edge_endpoints(definition, node_ids))
        errors.extend(self._check_edge_ports(definition, node_map))
        errors.extend(self._check_port_fanin(definition, node_map))
        errors.extend(self._check_required_inputs(definition))
        if self._has_cycle(definition):
            errors.append("Pipeline contains at least one cycle.")

        node_errors, warnings = self._collect_node_issues(definition)
        errors.extend(node_errors)

        return PipelineValidationResult(valid=not errors, errors=errors, warnings=warnings)

    def _check_node_identity(
        self,
        definition: PipelineDefinition,
        node_ids: set[str],
    ) -> list[str]:
        """Flag duplicate node ids and node types missing from the registry."""
        errors: list[str] = []
        if len(node_ids) != len(definition.nodes):
            errors.append("Duplicate node ids detected.")
        for node in definition.nodes:
            if node.type not in self._registry.node_types():
                errors.append(f"Unknown node type '{node.type}' for node '{node.id}'.")
        return errors

    @staticmethod
    def _check_edge_endpoints(
        definition: PipelineDefinition,
        node_ids: set[str],
    ) -> list[str]:
        """Flag edges whose source or target node id doesn't exist."""
        errors: list[str] = []
        for edge in definition.edges:
            if edge.source not in node_ids:
                errors.append(f"Edge '{edge.id}' has unknown source '{edge.source}'.")
            if edge.target not in node_ids:
                errors.append(f"Edge '{edge.id}' has unknown target '{edge.target}'.")
        return errors

    def _check_edge_ports(
        self,
        definition: PipelineDefinition,
        node_map: dict[str, PipelineNodeDefinition],
    ) -> list[str]:
        """Flag edges referencing missing ports or connecting incompatible types."""
        errors: list[str] = []
        for edge in definition.edges:
            source_def = node_map.get(edge.source)
            target_def = node_map.get(edge.target)
            source_spec = self._registry.get_spec(source_def.type) if source_def else None
            target_spec = self._registry.get_spec(target_def.type) if target_def else None
            source_port = None
            target_port = None
            if source_spec and edge.source_port:
                source_port = next(
                    (port for port in source_spec.output_ports if port.key == edge.source_port),
                    None,
                )
                if source_port is None:
                    errors.append(
                        f"Edge '{edge.id}' references missing output port "
                        f"'{edge.source_port}' on '{edge.source}'."
                    )
            if target_spec and edge.target_port:
                target_port = next(
                    (port for port in target_spec.input_ports if port.key == edge.target_port),
                    None,
                )
                if target_port is None:
                    errors.append(
                        f"Edge '{edge.id}' references missing input port "
                        f"'{edge.target_port}' on '{edge.target}'."
                    )
            if (
                source_port
                and target_port
                and not compatible(source_port.data_type, target_port.data_type)
            ):
                errors.append(
                    f"Edge '{edge.id}' connects incompatible port types "
                    f"'{source_port.data_type}' -> '{target_port.data_type}'."
                )
        return errors

    def _check_port_fanin(
        self,
        definition: PipelineDefinition,
        node_map: dict[str, PipelineNodeDefinition],
    ) -> list[str]:
        """Flag multiple edges into an input port unless it accepts many.

        Without this check a second edge into a single-value port would
        silently overwrite the first at execution time.
        """
        errors: list[str] = []
        counts: dict[tuple[str, str], int] = {}
        for edge in definition.edges:
            key = (edge.target, edge.target_port or "default")
            counts[key] = counts.get(key, 0) + 1
        for (target, port_key), count in counts.items():
            if count < 2:
                continue
            target_def = node_map.get(target)
            spec = self._registry.get_spec(target_def.type) if target_def else None
            if spec is None:
                continue
            port = next((p for p in spec.input_ports if p.key == port_key), None)
            if port is not None and not port.accepts_many:
                errors.append(
                    f"Node '{target}' input port '{port_key}' has {count} incoming "
                    "edges but accepts only one."
                )
        return errors

    def _check_required_inputs(self, definition: PipelineDefinition) -> list[str]:
        """Flag nodes missing inbound edges for their required input ports."""
        errors: list[str] = []
        incoming = definition.incoming_edges()
        for node in definition.nodes:
            spec = self._registry.get_spec(node.type)
            if not spec:
                continue
            required_inputs = {port.key for port in spec.input_ports if port.required}
            inbound_ports = {edge.target_port or "default" for edge in incoming.get(node.id, [])}
            missing_ports = required_inputs - inbound_ports
            if missing_ports:
                missing_list = ", ".join(sorted(missing_ports))
                errors.append(f"Node '{node.id}' missing inbound edges for: {missing_list}.")
        return errors

    @staticmethod
    def _has_cycle(definition: PipelineDefinition) -> bool:
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

    def _collect_node_issues(
        self,
        definition: PipelineDefinition,
    ) -> tuple[list[str], list[str]]:
        """Run each node class's own validation hook and split issues by severity."""
        errors: list[str] = []
        warnings: list[str] = []
        for node in definition.nodes:
            node_cls = self._registry.get_node_class(node.type)
            if not node_cls:
                continue
            issues = node_cls.validation_issues_for_node(node, definition, self._registry)
            for issue in issues:
                if issue.severity == "warning":
                    warnings.append(issue.message)
                else:
                    errors.append(issue.message)
        return errors, warnings
