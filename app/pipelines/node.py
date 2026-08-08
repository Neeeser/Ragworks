"""Base class and specification contract for pipeline nodes."""

from __future__ import annotations

import builtins
from collections.abc import Sequence
from typing import TYPE_CHECKING, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.model_modality_rules import ModelModalityRule
from app.pipelines.node_ports import DynamicPortSpec
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary
from app.schemas.enums import IndexBackend

if TYPE_CHECKING:
    # Deferred to break the node.py <-> registry.py import cycle: registry.py
    # imports concrete node classes (which import PipelineNodeBase from here),
    # while this module only needs NodeRegistry as a type annotation.
    from app.pipelines.registry import NodeRegistry

ConfigT = TypeVar("ConfigT", bound=BaseModel)


class NodePreset(BaseModel):
    """One named starting configuration for a node type.

    Presets are how named methods (contextual retrieval, HyDE, query
    expansion) ship without their own node types: the editor's library
    offers them beside the raw node, and dropping one instantiates the node
    with `config` seeded — fully editable afterwards. `config` is merged
    over the node type's `default_config`.
    """

    id: str
    label: str
    description: str = Field(min_length=1)
    config: dict[str, object] = Field(default_factory=dict)


class ContentTypeClaim(BaseModel):
    """What a wired node says it can parse, for one pipeline's coverage.

    `any_type` is how a node whose policy is "decode whatever arrives"
    (Extract Text's `plain_text`) states that no content type is left
    unclaimed — a set can only ever list the types a registry knows.
    """

    types: frozenset[str] = frozenset()
    any_type: bool = False


class NodeSpec(BaseModel):
    """Metadata describing an available pipeline node type.

    `hidden` marks node types that stay registered (persisted definitions
    reference type ids permanently) but should not be offered in the editor's
    catalog -- deprecated backend-specific variants and internal nodes.

    `supported_backends` names the vector-store backends a store-bound node
    works with (`None` for nodes with no store identity at all). Derived from
    the capability catalog, never hand-listed — the editor renders it so a
    user learns a backend-specific node is off-limits before wiring it in.
    """

    type: str
    label: str
    category: str
    description: str = Field(min_length=1)
    example: str = Field(min_length=1)
    input_ports: list[NodePort] = Field(default_factory=list)
    output_ports: list[NodePort] = Field(default_factory=list)
    #: How this node's config adds output ports beyond the declared ones
    #: (`None` for every node whose fan-out its class fixes). Resolved
    #: through `app/pipelines/node_ports.py`, which the editor mirrors.
    dynamic_output_ports: DynamicPortSpec | None = None
    config_schema: dict[str, object] = Field(default_factory=dict)
    default_config: dict[str, object] = Field(default_factory=dict)
    hidden: bool = False
    supported_backends: list[str] | None = None
    presets: list[NodePreset] = Field(default_factory=list)
    #: Content types this node's capability registry answers for (`None`
    #: for nodes that parse nothing). The editor reads it to say which
    #: uploads a wired graph covers, and a new handler upgrades every
    #: pipeline that already wired the node.
    handled_content_types: list[str] | None = None
    #: True when the selected model widens this node's `accepts` beyond the
    #: declared floor. The editor's instant analysis reports only findings no
    #: model choice can cure for such nodes; the server, which resolves the
    #: model's catalog, answers the rest.
    model_widens_accepts: bool = False


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
    #: Set by nodes whose user-defined config list adds output ports.
    dynamic_output_ports: DynamicPortSpec | None = None
    config_model: builtins.type[BaseModel] = EmptyConfig
    hidden: bool = False
    presets: Sequence[NodePreset] = ()
    #: Set by nodes whose selected model decides, or must satisfy, what the
    #: node accepts (`app/pipelines/model_modality_rules.py`). `None` means the
    #: node runs no model, so no catalog governs its ports.
    model_modality: ModelModalityRule | None = None
    #: The content types this node's capability registry handles. `None`
    #: for every node that does not parse files.
    handled_content_types: frozenset[str] | None = None

    def __init__(self, config: ConfigT) -> None:
        """Initialize the node with its config."""
        self.config: ConfigT = config

    # Abstract signature: kept typed here so concrete nodes' `run` overrides
    # satisfy the interface contract's parameter names; this base raises before
    # touching them.
    def run(
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

    def degraded_reasons(self) -> tuple[str, ...]:
        """Failures the last `run` absorbed while still producing output.

        Non-empty marks the node run degraded rather than completed: it
        emitted something, but not what it was asked to. A node that never
        absorbs a failure keeps the empty default.
        """
        return ()

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
    def content_type_claim(cls, _config: dict[str, object]) -> ContentTypeClaim | None:
        """Return what this node, configured this way, claims to parse.

        `None` — the default — means the node parses nothing, so it never
        takes part in a pipeline's content-type coverage. Config is passed
        because a node's claim can depend on it (an unknown-format policy
        of "decode as plain text" claims every type).
        """
        if cls.handled_content_types is None:
            return None
        return ContentTypeClaim(types=cls.handled_content_types)

    @classmethod
    def removes_for_node(cls, _config: dict[str, object]) -> dict[str, tuple[str, ...]]:
        """Return the facets this node, configured this way, destroys.

        Keyed by output port key; an absent port keeps the `removes` its
        declaration carries. The default is empty, so a node whose
        rewriting is unconditional states it on the port itself and never
        implements this. Config is passed because a shell's writes can
        depend on it: one set of output fields rewrites an item's text
        while another only adds metadata beside it, and declaring the
        first statically would reject `embed -> extract metadata -> index`,
        a graph in which nothing is invalidated.
        """
        return {}

    @classmethod
    def supported_backends(cls) -> tuple[IndexBackend, ...] | None:
        """Return the vector-store backends this node works with.

        `None` (the default) means the node has no store identity at all —
        chunkers, embedders, fusion, terminals. Store-bound nodes override
        this by *deriving* from the capability catalog (`backends_where`),
        never by hand-listing backends.
        """
        return None

    @classmethod
    def spec(cls) -> NodeSpec:
        """Return the registry spec for this node type."""
        if not cls.description or not cls.description.strip():
            raise ValueError(f"Node {cls.type} must define a description.")
        if not cls.example or not cls.example.strip():
            raise ValueError(f"Node {cls.type} must define an example.")
        schema = cls.config_model.model_json_schema()
        default_config = cls.config_model().model_dump()
        backends = cls.supported_backends()
        return NodeSpec(
            type=cls.type,
            label=cls.label,
            category=cls.category,
            description=cls.description,
            example=cls.example,
            input_ports=list(cls.input_ports),
            output_ports=list(cls.output_ports),
            dynamic_output_ports=cls.dynamic_output_ports,
            config_schema=schema,
            default_config=default_config,
            hidden=cls.hidden,
            supported_backends=(
                [backend.value for backend in backends] if backends is not None else None
            ),
            presets=list(cls.presets),
            handled_content_types=(
                sorted(cls.handled_content_types)
                if cls.handled_content_types is not None
                else None
            ),
            model_widens_accepts=(
                cls.model_modality is not None and cls.model_modality.follows_model
            ),
        )
