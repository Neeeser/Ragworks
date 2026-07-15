"""Base class and specification contract for pipeline nodes."""

from __future__ import annotations

import builtins
from collections.abc import Sequence
from typing import TYPE_CHECKING, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary

if TYPE_CHECKING:
    # Deferred to break the node.py <-> registry.py import cycle: registry.py
    # imports concrete node classes (which import PipelineNodeBase from here),
    # while this module only needs NodeRegistry as a type annotation.
    from app.pipelines.registry import NodeRegistry

ConfigT = TypeVar("ConfigT", bound=BaseModel)


class NodeSpec(BaseModel):
    """Metadata describing an available pipeline node type.

    `hidden` marks node types that stay registered (persisted definitions
    reference type ids permanently) but should not be offered in the editor's
    catalog -- deprecated backend-specific variants and internal nodes.
    """

    type: str
    label: str
    category: str
    description: str = Field(min_length=1)
    example: str = Field(min_length=1)
    input_ports: list[NodePort] = Field(default_factory=list)
    output_ports: list[NodePort] = Field(default_factory=list)
    config_schema: dict[str, object] = Field(default_factory=dict)
    default_config: dict[str, object] = Field(default_factory=dict)
    hidden: bool = False


class PipelineValidationIssue(BaseModel):
    """Structured validation issue for pipeline definitions."""

    message: str
    severity: Literal["error", "warning"] = "error"
    code: str | None = None
    node_id: str | None = None
    field: str | None = None
    configured_value: str | int | float | bool | None = None
    model: str | None = None
    allowed_max: int | None = None


class EmptyConfig(BaseModel):
    """Empty configuration payload for nodes with no options."""


class PipelineNodeBase(Generic[ConfigT]):
    """Base class for pipeline nodes.

    Subclasses parameterize the generic (`class FooNode(PipelineNodeBase[FooConfig])`)
    so `self.config` is typed as their concrete config model rather than the
    base `BaseModel`.
    """

    type: str = "base"
    label: str = "Base Node"
    category: str = "utility"
    description: str = ""
    example: str = ""
    input_ports: Sequence[NodePort] = ()
    output_ports: Sequence[NodePort] = ()
    config_model: builtins.type[BaseModel] = EmptyConfig
    hidden: bool = False

    def __init__(self, config: ConfigT) -> None:
        """Initialize the node with its config."""
        self.config: ConfigT = config

    # Abstract signature: kept typed here so concrete nodes' `run` overrides
    # satisfy the interface contract's parameter names; this base raises before
    # touching them.
    def run(  # pylint: disable=unused-argument
        self,
        inputs: dict[str, object],
        context: PipelineRunContext,
    ) -> dict[str, object]:
        """Execute the node and return outputs by port key."""
        raise NotImplementedError

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Return a summary of the node's key inputs and outputs."""
        raise NotImplementedError

    @classmethod
    def validation_issues_for_node(
        cls,
        _node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Return validation issues for a node within a definition."""
        return []

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
            hidden=cls.hidden,
        )
