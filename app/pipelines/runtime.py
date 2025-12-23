"""Runtime helpers for executing pipeline definitions."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Set, Type, TypeVar

from pydantic import BaseModel, Field

from pinecone import Pinecone
from sqlmodel import Session

from app.api.config import Settings
from app.db import models
from app.pipelines.models import PipelineDefinition, PipelineNodeDefinition
from app.services.openrouter import OpenRouterClient
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)

NodeConfigT = TypeVar("NodeConfigT", bound=BaseModel)


class NodePort(BaseModel):
    """Port metadata describing node input/output connectivity."""

    key: str
    label: str
    data_type: str
    required: bool = True


class NodeSpec(BaseModel):
    """Metadata describing an available pipeline node type."""

    type: str
    label: str
    category: str
    description: str = Field(min_length=1)
    example: str = Field(min_length=1)
    input_ports: List[NodePort] = Field(default_factory=list)
    output_ports: List[NodePort] = Field(default_factory=list)
    config_schema: Dict[str, object] = Field(default_factory=dict)
    default_config: Dict[str, object] = Field(default_factory=dict)


class EmptyConfig(BaseModel):
    """Empty configuration payload for nodes with no options."""


class PipelineNodeBase:
    """Base class for pipeline nodes."""

    type: str = "base"
    label: str = "Base Node"
    category: str = "utility"
    description: str = ""
    example: str = ""
    input_ports: Sequence[NodePort] = ()
    output_ports: Sequence[NodePort] = ()
    config_model: Type[BaseModel] = EmptyConfig

    def __init__(self, config: BaseModel) -> None:
        """Initialize the node with its config."""
        self.config = config

    def run(  # pylint: disable=unused-argument
        self,
        inputs: Dict[str, object],
        context: "PipelineRunContext",
    ) -> Dict[str, object]:
        """Execute the node and return outputs by port key."""
        raise NotImplementedError

    @classmethod
    def spec(cls) -> NodeSpec:
        """Return the registry spec for this node type."""
        if not cls.description or not cls.description.strip():
            raise ValueError(f"Node {cls.type} must define a description.")
        if not cls.example or not cls.example.strip():
            raise ValueError(f"Node {cls.type} must define an example.")
        schema = cls.config_model.model_json_schema()
        default_config = cls.config_model().model_dump()
        return NodeSpec(
            type=cls.type,
            label=cls.label,
            category=cls.category,
            description=cls.description,
            example=cls.example,
            input_ports=list(cls.input_ports),
            output_ports=list(cls.output_ports),
            config_schema=schema,
            default_config=default_config,
        )


class NodeRegistry:
    """Registry for available pipeline nodes."""

    def __init__(self, nodes: Iterable[type[PipelineNodeBase]]) -> None:
        """Initialize the registry with node classes."""
        self._nodes = {node.type: node for node in nodes}

    def node_types(self) -> Set[str]:
        """Return the set of available node type ids."""
        return set(self._nodes.keys())

    def create(self, definition: PipelineNodeDefinition) -> PipelineNodeBase:
        """Instantiate a node from its definition."""
        node_cls = self._nodes.get(definition.type)
        if node_cls is None:
            raise ValueError(f"Unknown node type: {definition.type}")
        config = node_cls.config_model.model_validate(definition.config)
        return node_cls(config)

    def specs(self) -> List[NodeSpec]:
        """Return specs for all registered nodes."""
        return [node.spec() for node in self._nodes.values()]

    def get_spec(self, node_type: str) -> Optional[NodeSpec]:
        """Return a node spec for the requested type."""
        node_cls = self._nodes.get(node_type)
        return node_cls.spec() if node_cls else None


class PipelineValidationResult(BaseModel):
    """Validation output for pipeline definitions."""

    valid: bool
    errors: List[str] = Field(default_factory=list)


class PipelineExecutionError(RuntimeError):
    """Raised when pipeline execution fails."""


@dataclass
class PipelineRunContext:  # pylint: disable=too-many-instance-attributes
    """Execution context shared by pipeline nodes."""

    session: Session
    user: models.User
    collection: models.Collection
    document: Optional[models.Document]
    query: Optional[str]
    top_k: Optional[int]
    openrouter: OpenRouterClient
    pinecone: Pinecone
    storage: FileStorage
    settings: Settings


@dataclass
class PipelineExecutionResult:  # pylint: disable=too-few-public-methods
    """Pipeline execution outputs."""

    outputs_by_node: Dict[str, Dict[str, object]]
    terminal_outputs: Dict[str, Dict[str, object]]


class PipelineValidator:  # pylint: disable=too-few-public-methods
    """Validation helper for pipeline definitions."""

    def __init__(self, registry: NodeRegistry) -> None:
        """Initialize the validator with a node registry."""
        self._registry = registry

    # pylint: disable=too-many-branches,too-many-locals
    def validate(self, definition: PipelineDefinition) -> PipelineValidationResult:
        """Validate the pipeline definition and return any errors."""
        errors: List[str] = []
        node_map = definition.node_map()
        node_ids = {node.id for node in definition.nodes}
        if len(node_ids) != len(definition.nodes):
            errors.append("Duplicate node ids detected.")

        for node in definition.nodes:
            if node.type not in self._registry.node_types():
                errors.append(f"Unknown node type '{node.type}' for node '{node.id}'.")

        for edge in definition.edges:
            if edge.source not in node_ids:
                errors.append(f"Edge '{edge.id}' has unknown source '{edge.source}'.")
            if edge.target not in node_ids:
                errors.append(f"Edge '{edge.id}' has unknown target '{edge.target}'.")
            source_def = node_map.get(edge.source)
            target_def = node_map.get(edge.target)
            source_spec = self._registry.get_spec(source_def.type) if source_def else None
            target_spec = self._registry.get_spec(target_def.type) if target_def else None
            if source_spec and edge.source_port:
                if edge.source_port not in {port.key for port in source_spec.output_ports}:
                    errors.append(
                        (
                            f"Edge '{edge.id}' references missing output port "
                            f"'{edge.source_port}' on '{edge.source}'."
                        )
                    )
            if target_spec and edge.target_port:
                if edge.target_port not in {port.key for port in target_spec.input_ports}:
                    errors.append(
                        (
                            f"Edge '{edge.id}' references missing input port "
                            f"'{edge.target_port}' on '{edge.target}'."
                        )
                    )

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

        if self._has_cycle(definition):
            errors.append("Pipeline contains at least one cycle.")

        return PipelineValidationResult(valid=not errors, errors=errors)

    def _has_cycle(self, definition: PipelineDefinition) -> bool:
        """Detect cycles using depth-first traversal."""
        adjacency: Dict[str, List[str]] = {node.id: [] for node in definition.nodes}
        for edge in definition.edges:
            if edge.source in adjacency:
                adjacency[edge.source].append(edge.target)

        visited: Set[str] = set()
        visiting: Set[str] = set()

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


class PipelineExecutor:  # pylint: disable=too-few-public-methods
    """Executor for pipeline definitions."""

    def __init__(self, registry: NodeRegistry) -> None:
        """Initialize the executor with a node registry."""
        self._registry = registry
        self._validator = PipelineValidator(registry)

    # pylint: disable=too-many-locals,too-many-branches
    def execute(
        self,
        definition: PipelineDefinition,
        context: PipelineRunContext,
    ) -> PipelineExecutionResult:
        """Execute the pipeline definition and return outputs."""
        validation = self._validator.validate(definition)
        if not validation.valid:
            raise PipelineExecutionError("; ".join(validation.errors))

        node_map = definition.node_map()
        outgoing = definition.outgoing_edges()
        inputs: Dict[str, Dict[str, object]] = {node_id: {} for node_id in node_map}
        outputs: Dict[str, Dict[str, object]] = {}
        pending = set(node_map.keys())
        progressed = True

        while pending and progressed:
            progressed = False
            for node_id in list(pending):
                node_def = node_map[node_id]
                node_spec = self._registry.get_spec(node_def.type)
                if node_spec is None:
                    raise PipelineExecutionError(f"Node type '{node_def.type}' not found.")
                required_inputs = {
                    port.key for port in node_spec.input_ports if port.required
                }
                available_inputs = inputs[node_id]
                if required_inputs and not required_inputs.issubset(available_inputs.keys()):
                    continue

                node = self._registry.create(node_def)
                logger.debug("Executing pipeline node %s (%s)", node_id, node_def.type)
                node_outputs = node.run(available_inputs, context)
                outputs[node_id] = node_outputs
                pending.remove(node_id)
                progressed = True

                for edge in outgoing.get(node_id, []):
                    output_key = edge.source_port or "default"
                    if output_key not in node_outputs:
                        continue
                    target_inputs = inputs[edge.target]
                    input_key = edge.target_port or "default"
                    target_inputs[input_key] = node_outputs[output_key]

        if pending:
            stalled_without_inputs = [node_id for node_id in pending if not inputs[node_id]]
            if len(stalled_without_inputs) == len(pending):
                logger.info(
                    "Skipping %s branch node(s) with no inputs.",
                    len(stalled_without_inputs),
                )
                pending.clear()
            else:
                missing_nodes = ", ".join(sorted(pending))
                raise PipelineExecutionError(
                    f"Pipeline stalled. Missing inputs for nodes: {missing_nodes}."
                )

        terminal_outputs = {
            node_id: node_outputs
            for node_id, node_outputs in outputs.items()
            if node_id not in outgoing
        }
        return PipelineExecutionResult(outputs_by_node=outputs, terminal_outputs=terminal_outputs)
