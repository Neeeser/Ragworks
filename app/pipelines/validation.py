"""Validation of pipeline definitions against a node registry."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.backend_support import backend_support_issues
from app.pipelines.config_removes import RemovesOverrides, resolve_config_removes
from app.pipelines.content_coverage import AutoIngestTypesResolver, content_coverage_issues
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.embedding_dimensions import embedding_dimension_issues
from app.pipelines.embedding_limits import embedding_limit_issues
from app.pipelines.facets import EdgeRef, NodePorts, facet_issues
from app.pipelines.modality import modality_issues
from app.pipelines.model_modalities import (
    AcceptsOverrides,
    ModalityResolver,
    resolve_model_modalities,
)
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.ports import NodePort, compatible_kinds
from app.pipelines.registry import NodeRegistry
from app.pipelines.resolution import resolve_static_definition, strip_expressions
from app.pipelines.validation_variables import collect_variable_issues
from app.schemas.enums import IndexBackend

EmbeddingInputLimitResolver = Callable[[UUID, str], int | None]
EmbeddingDimensionResolver = Callable[[UUID, str], int | None]
IndexWidthResolver = Callable[[IndexBackend, str], int | None]


class PipelineValidationResult(BaseModel):
    """Validation output for pipeline definitions."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    issues: list[PipelineValidationIssue] = Field(default_factory=list)


class PipelineValidator:
    """Validation helper for pipeline definitions."""

    def __init__(
        self,
        registry: NodeRegistry,
        *,
        embedding_input_limit: EmbeddingInputLimitResolver | None = None,
        embedding_dimension: EmbeddingDimensionResolver | None = None,
        index_width: IndexWidthResolver | None = None,
        model_modalities: ModalityResolver | None = None,
        auto_ingest_types: AutoIngestTypesResolver | None = None,
    ) -> None:
        """Initialize with registry metadata and optional provider resolvers."""
        self._registry = registry
        self._embedding_input_limit = embedding_input_limit
        self._embedding_dimension = embedding_dimension
        self._index_width = index_width
        self._model_modalities = model_modalities
        self._auto_ingest_types = auto_ingest_types

    def validate(self, definition: PipelineDefinition) -> PipelineValidationResult:
        """Validate the pipeline definition and return any errors."""
        node_ids = {node.id for node in definition.nodes}
        node_map = definition.node_map()

        # What a model-backed node really accepts depends on its model, so
        # this resolves first: the graph analysis below reads the overrides,
        # and without them a multimodal embedding model would still report
        # its images as reaching no index.
        modality_issues_from_models, accepts_overrides = resolve_model_modalities(
            definition, self._registry, self._model_modalities
        )

        issues = collect_variable_issues(definition, self._registry)
        issues.extend(modality_issues_from_models)
        # Per-node hooks validate configs through their config models, which
        # cannot hold `{"$expr": ...}` values — run them against the statically
        # resolved definition (argument defaults), falling back to stripping
        # expressions when the environment itself is broken. The graph checks
        # read it too: what a node destroys can depend on its config, and an
        # unresolved expression is not a config any node model can answer for.
        hook_definition = self._definition_for_node_hooks(definition, issues)
        removes_overrides = resolve_config_removes(hook_definition, self._registry)

        errors: list[str] = []
        errors.extend(self._check_node_identity(definition, node_ids))
        errors.extend(self._check_edge_endpoints(definition, node_ids))
        errors.extend(self._check_edge_ports(definition, node_map))
        errors.extend(self._check_port_fanin(definition, node_map))
        errors.extend(self._check_required_inputs(definition))
        cyclic = self._has_cycle(definition)
        if cyclic:
            errors.append("Pipeline contains at least one cycle.")
        else:
            errors.extend(self._check_facets(definition, accepts_overrides, removes_overrides))

        if not cyclic:
            issues.extend(self._check_modality(definition, accepts_overrides, removes_overrides))
        issues.extend(self._collect_node_issues(hook_definition))
        issues.extend(
            embedding_limit_issues(hook_definition, self._registry, self._embedding_input_limit)
        )
        issues.extend(
            embedding_dimension_issues(
                hook_definition,
                self._registry,
                self._embedding_dimension,
                self._index_width,
            )
        )
        issues.extend(backend_support_issues(hook_definition, self._registry))
        issues.extend(
            content_coverage_issues(hook_definition, self._registry, self._auto_ingest_types)
        )
        node_errors = [issue.message for issue in issues if issue.severity == "error"]
        warnings = [issue.message for issue in issues if issue.severity == "warning"]
        errors.extend(node_errors)

        return PipelineValidationResult(
            valid=not errors,
            errors=errors,
            warnings=warnings,
            issues=issues,
        )

    @staticmethod
    def _definition_for_node_hooks(
        definition: PipelineDefinition,
        variable_issues: list[PipelineValidationIssue],
    ) -> PipelineDefinition:
        """Return the literal-config definition per-node validation hooks see."""
        if any(issue.severity == "error" for issue in variable_issues):
            return strip_expressions(definition)
        return resolve_static_definition(definition)

    def _check_node_identity(
        self,
        definition: PipelineDefinition,
        node_ids: set[str],
    ) -> list[str]:
        """Flag duplicate node ids and node types missing from the registry."""
        errors: list[str] = []
        if len(node_ids) != len(definition.nodes):
            errors.append("Duplicate node ids detected.")
        errors.extend(
            f"Unknown node type '{node.type}' for node '{node.id}'."
            for node in definition.nodes
            if node.type not in self._registry.node_types()
        )
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
                and not compatible_kinds(source_port.data_type, target_port.data_type)
            ):
                errors.append(
                    f"Edge '{edge.id}' connects incompatible port types "
                    f"'{source_port.data_type}' -> '{target_port.data_type}'."
                )
        return errors

    def _check_facets(
        self,
        definition: PipelineDefinition,
        overrides: AcceptsOverrides,
        removes: RemovesOverrides,
    ) -> list[str]:
        """Flag edges whose item stream misses facets the target requires.

        Facet guarantees are inferred through the whole (acyclic) graph, so
        this runs only when no cycle was detected.
        """
        node_ports, edges = self._graph_view(definition, overrides, removes)
        return [issue.message for issue in facet_issues(node_ports, edges, node_labels(definition))]

    def _check_modality(
        self,
        definition: PipelineDefinition,
        overrides: AcceptsOverrides,
        removes: RemovesOverrides,
    ) -> list[PipelineValidationIssue]:
        """Flag nodes that can process nothing and modalities nothing indexes."""
        node_ports, edges = self._graph_view(definition, overrides, removes)
        return [
            PipelineValidationIssue(
                message=issue.message,
                severity="error" if issue.severity == "error" else "warning",
                code=f"modality.{issue.kind}",
                node_id=issue.node_id,
            )
            for issue in modality_issues(node_ports, edges, node_labels(definition))
        ]

    def _graph_view(
        self,
        definition: PipelineDefinition,
        overrides: AcceptsOverrides,
        removes: RemovesOverrides,
    ) -> tuple[NodePorts, list[EdgeRef]]:
        """Project a definition onto the port/edge view both graph checks read.

        A port whose node's model widened its `accepts`, or whose config
        decides what the node destroys, is projected with the resolved
        value, so both checks see the graph as it will run.
        """
        node_ports: NodePorts = {
            node.id: (
                [_with_accepts(port, overrides.get((node.id, port.key))) for port in spec.input_ports],
                [_with_removes(port, removes.get((node.id, port.key))) for port in spec.output_ports],
            )
            for node in definition.nodes
            if (spec := self._registry.get_spec(node.type)) is not None
        }
        edges = [
            EdgeRef(
                id=edge.id,
                source=edge.source,
                source_port=edge.source_port,
                target=edge.target,
                target_port=edge.target_port,
            )
            for edge in definition.edges
        ]
        return node_ports, edges

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
    ) -> list[PipelineValidationIssue]:
        """Run each node class's own validation hook."""
        issues: list[PipelineValidationIssue] = []
        for node in definition.nodes:
            node_cls = self._registry.get_node_class(node.type)
            if not node_cls:
                continue
            issues.extend(node_cls.validation_issues_for_node(node, definition, self._registry))
        return issues


def node_labels(definition: PipelineDefinition) -> dict[str, str]:
    """Map node ids to what a finding should call them.

    A node's editor name, falling back to its type: a message naming a
    node UUID is unreadable next to a canvas where every node shows a
    name.
    """
    return {node.id: node.display_name for node in definition.nodes}


def _with_accepts(port: NodePort, accepts: frozenset[str] | None) -> NodePort:
    """Return the port, with its accepts replaced when a model widened it."""
    if accepts is None:
        return port
    return port.model_copy(update={"accepts": tuple(sorted(accepts))})


def _with_removes(port: NodePort, removes: tuple[str, ...] | None) -> NodePort:
    """Return the port, with its removes replaced when config decided them."""
    if removes is None:
        return port
    return port.model_copy(update={"removes": removes})

