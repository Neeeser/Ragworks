"""Validation of pipeline definitions against a node registry."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.nodes.chunking import BaseChunkerNode, FixedChunkerConfig
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.ports import compatible
from app.pipelines.registry import NodeRegistry
from app.pipelines.resolution import (
    VariableResolutionError,
    default_environment,
    resolve_definition,
    strip_expressions,
)
from app.pipelines.validation_variables import collect_variable_issues
from app.providers.base import effective_embedding_input_limit

EmbeddingInputLimitResolver = Callable[[UUID, str], int | None]


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
    ) -> None:
        """Initialize with registry metadata and an optional limit resolver."""
        self._registry = registry
        self._embedding_input_limit = embedding_input_limit

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

        issues = collect_variable_issues(definition, self._registry)
        # Per-node hooks validate configs through their config models, which
        # cannot hold `{"$expr": ...}` values — run them against the statically
        # resolved definition (argument defaults), falling back to stripping
        # expressions when the environment itself is broken.
        hook_definition = self._definition_for_node_hooks(definition, issues)
        issues.extend(self._collect_node_issues(hook_definition))
        issues.extend(self._check_embedding_input_limits(hook_definition))
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
        try:
            return resolve_definition(definition, default_environment(definition))
        except VariableResolutionError:
            return strip_expressions(definition)

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
    ) -> list[PipelineValidationIssue]:
        """Run each node class's own validation hook."""
        issues: list[PipelineValidationIssue] = []
        for node in definition.nodes:
            node_cls = self._registry.get_node_class(node.type)
            if not node_cls:
                continue
            issues.extend(node_cls.validation_issues_for_node(node, definition, self._registry))
        return issues

    def _check_embedding_input_limits(
        self,
        definition: PipelineDefinition,
    ) -> list[PipelineValidationIssue]:
        """Compare each chunker feeding an embedder with its provider limit."""
        if self._embedding_input_limit is None:
            return []
        node_map = definition.node_map()
        incoming = definition.incoming_edges()
        chunk_input = next(
            port.key for port in EmbedderNode.input_ports if port.data_type == "chunk_batch"
        )
        issues: list[PipelineValidationIssue] = []
        for embedder in definition.nodes:
            if embedder.type != EmbedderNode.type:
                continue
            config = EmbedderConfig.model_validate(embedder.config or {})
            if config.connection_id is None or not config.model_name:
                continue
            chunkers = self._connected_chunkers(
                incoming.get(embedder.id, []), node_map, chunk_input
            )
            if not chunkers:
                continue
            published_limit = self._embedding_input_limit(
                config.connection_id, config.model_name
            )
            if published_limit is None:
                issues.append(
                    self._unknown_embedding_limit_issue(embedder.id, config.model_name)
                )
                continue
            maximum = effective_embedding_input_limit(published_limit)
            for chunker in chunkers:
                issue = self._chunk_limit_issue(
                    chunker,
                    model=config.model_name,
                    maximum=maximum,
                )
                if issue is not None:
                    issues.append(issue)
        return issues

    def _connected_chunkers(
        self,
        edges: list[PipelineEdgeDefinition],
        node_map: dict[str, PipelineNodeDefinition],
        chunk_input: str,
    ) -> list[PipelineNodeDefinition]:
        """Return real chunker nodes connected to an embedder's chunk input."""
        chunkers: list[PipelineNodeDefinition] = []
        for edge in edges:
            if edge.target_port not in (None, chunk_input):
                continue
            chunker = node_map.get(edge.source)
            if chunker is None:
                continue
            chunker_cls = self._registry.get_node_class(chunker.type)
            if chunker_cls is not None and issubclass(chunker_cls, BaseChunkerNode):
                chunkers.append(chunker)
        return chunkers

    def _chunk_limit_issue(
        self,
        chunker: PipelineNodeDefinition,
        *,
        model: str,
        maximum: int,
    ) -> PipelineValidationIssue | None:
        """Build a severity-aware issue for an oversized configured span."""
        try:
            config = FixedChunkerConfig.model_validate(chunker.config or {})
        except ValidationError:
            return None
        chunk_size = getattr(config, "chunk_size", None)
        chunk_overlap = getattr(config, "chunk_overlap", None)
        if not isinstance(chunk_size, int) or not isinstance(chunk_overlap, int):
            return None
        configured_span = chunk_size + chunk_overlap
        if configured_span <= maximum:
            return None
        tokenizer = config.tokenizer
        is_whitespace = tokenizer == "whitespace"
        severity = "warning" if is_whitespace else "error"
        detail = (
            "The whitespace counter undercounts model tokens."
            if is_whitespace
            else f"The chunker uses {self._tokenizer_label(tokenizer)} token counts."
        )
        return PipelineValidationIssue(
            code="embedding_input_limit_exceeded",
            message=(
                f"Chunk size plus overlap ({configured_span:,}) on node '{chunker.id}' "
                f"exceeds embedding model '{model}' effective input limit of {maximum:,}. "
                f"{detail}"
            ),
            severity=severity,
            node_id=chunker.id,
            field="chunk_size",
            configured_value=configured_span,
            model=model,
            allowed_max=maximum,
        )

    @staticmethod
    def _tokenizer_label(tokenizer: str) -> str:
        """Return the established human-readable counter label."""
        return {
            "wordpiece": "BERT WordPiece",
            "cl100k": "cl100k",
            "huggingface": "HuggingFace tokenizer",
        }.get(tokenizer, tokenizer)

    @staticmethod
    def _unknown_embedding_limit_issue(
        node_id: str,
        model: str,
    ) -> PipelineValidationIssue:
        """Return the documented saveable warning for unpublished model limits."""
        return PipelineValidationIssue(
            code="embedding_input_limit_unknown",
            message=(
                f"Embedding model '{model}' does not publish an input token limit; "
                "chunk-size compatibility could not be verified."
            ),
            severity="warning",
            node_id=node_id,
            field="model_name",
            configured_value=model,
            model=model,
        )
