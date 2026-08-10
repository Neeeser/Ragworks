"""Validation of pipeline definitions against a node registry."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.backend_support import backend_support_issues
from app.pipelines.config_removes import RemovesOverrides, resolve_config_removes
from app.pipelines.definition import PipelineDefinition
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
from app.pipelines.node_ports import resolve_output_ports
from app.pipelines.ports import NodePort
from app.pipelines.registry import NodeRegistry
from app.pipelines.resolution import resolve_static_definition, strip_expressions
from app.pipelines.validation_graph import graph_structure_issues, has_cycle
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
    ) -> None:
        """Initialize with registry metadata and optional provider resolvers."""
        self._registry = registry
        self._embedding_input_limit = embedding_input_limit
        self._embedding_dimension = embedding_dimension
        self._index_width = index_width
        self._model_modalities = model_modalities

    def validate(self, definition: PipelineDefinition) -> PipelineValidationResult:
        """Validate the pipeline definition and return any errors."""
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

        graph_issues = graph_structure_issues(definition, self._registry)
        cyclic = has_cycle(definition)
        if not cyclic:
            graph_issues.extend(
                self._check_facets(definition, accepts_overrides, removes_overrides)
            )
            issues.extend(self._check_modality(definition, accepts_overrides, removes_overrides))
        issues.extend(self._collect_node_issues(hook_definition))
        issues.extend(
            embedding_limit_issues(
                hook_definition,
                self._registry,
                self._embedding_input_limit,
                accepts_overrides,
            )
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
        warnings = [issue.message for issue in issues if issue.severity == "warning"]
        # Structural findings lead, then the per-node ones — the same order the
        # flat list has always had, so a caller reading `errors` sees no change.
        errors = [
            *(issue.message for issue in graph_issues),
            *(issue.message for issue in issues if issue.severity == "error"),
        ]

        return PipelineValidationResult(
            valid=not errors,
            errors=errors,
            warnings=warnings,
            issues=[*graph_issues, *issues],
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

    def _check_facets(
        self,
        definition: PipelineDefinition,
        overrides: AcceptsOverrides,
        removes: RemovesOverrides,
    ) -> list[PipelineValidationIssue]:
        """Flag edges whose item stream misses facets the target requires.

        Facet guarantees are inferred through the whole (acyclic) graph, so
        this runs only when no cycle was detected.
        """
        node_ports, edges = self._graph_view(definition, overrides, removes)
        return [
            PipelineValidationIssue(
                message=issue.message,
                code="graph.facets",
                node_id=issue.target,
            )
            for issue in facet_issues(node_ports, edges, node_labels(definition))
        ]

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
                [
                    _with_accepts(port, overrides.get((node.id, port.key)))
                    for port in spec.input_ports
                ],
                [
                    _with_removes(port, removes.get((node.id, port.key)))
                    for port in resolve_output_ports(
                        spec.output_ports, spec.dynamic_output_ports, node
                    )
                ],
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
