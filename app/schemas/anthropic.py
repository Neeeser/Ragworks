"""Wire shapes for the Anthropic Messages API.

Modelled against the installed `anthropic` SDK's `Message`,
`RawMessageStreamEvent`, and `ModelInfo` types. Every model allows extras so a
block type this app does not consume (server tool use, citations, containers)
parses and is skipped rather than failing the turn.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MessagesUsage(BaseModel):
    """Token accounting on a Messages payload.

    Anthropic names the counters `input_tokens` / `output_tokens`; the dialect
    renames them so usage stays comparable with every other provider.
    """

    model_config = ConfigDict(extra="allow")

    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None


class MessagesContentBlock(BaseModel):
    """One block of assistant content.

    A single permissive model covers `text`, `tool_use`, and `thinking` because
    the discriminator is `type` and the fields read per type are disjoint.
    """

    model_config = ConfigDict(extra="allow")

    type: str | None = None
    # type == "text"
    text: str | None = None
    # type == "tool_use"
    id: str | None = None
    name: str | None = None
    input: dict[str, Any] | None = None
    # type == "thinking" / "redacted_thinking"
    thinking: str | None = None


class MessagesResponse(BaseModel):
    """Top-level Messages API payload."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    type: str | None = None
    role: str | None = None
    model: str | None = None
    content: list[MessagesContentBlock] = Field(default_factory=list)
    stop_reason: str | None = None
    stop_sequence: str | None = None
    usage: MessagesUsage | None = None


class MessagesStreamDelta(BaseModel):
    """The `delta` payload on a streaming event."""

    model_config = ConfigDict(extra="allow")

    type: str | None = None
    #: `text_delta`
    text: str | None = None
    #: `input_json_delta` — a fragment of a tool call's JSON arguments.
    partial_json: str | None = None
    #: `thinking_delta`
    thinking: str | None = None
    #: Present on the terminal `message_delta`.
    stop_reason: str | None = None
    stop_sequence: str | None = None


class MessagesStreamEvent(BaseModel):
    """One event of a streaming Messages call."""

    model_config = ConfigDict(extra="allow")

    type: str
    index: int | None = None
    delta: MessagesStreamDelta | None = None
    content_block: MessagesContentBlock | None = None
    message: MessagesResponse | None = None
    usage: MessagesUsage | None = None


class ThinkingTypeSupport(BaseModel):
    """Whether one thinking mode is supported by a model."""

    model_config = ConfigDict(extra="allow")

    supported: bool = False


class ThinkingCapability(BaseModel):
    """A model's extended-thinking capability block."""

    model_config = ConfigDict(extra="allow")

    supported: bool = False
    types: dict[str, ThinkingTypeSupport] = Field(default_factory=dict)

    @property
    def adaptive(self) -> bool:
        """True when the model takes `thinking: {"type": "adaptive"}`."""
        return self.types.get("adaptive", ThinkingTypeSupport()).supported

    @property
    def budgeted(self) -> bool:
        """True when the model takes `thinking: {"type": "enabled", ...}`."""
        return self.types.get("enabled", ThinkingTypeSupport()).supported


class EffortCapability(BaseModel):
    """A model's `output_config.effort` capability block."""

    model_config = ConfigDict(extra="allow")

    supported: bool = False


class ModelCapabilities(BaseModel):
    """The capability tree published for one model."""

    model_config = ConfigDict(extra="allow")

    thinking: ThinkingCapability = Field(default_factory=ThinkingCapability)
    effort: EffortCapability = Field(default_factory=EffortCapability)


class AnthropicModel(BaseModel):
    """One entry of `GET /v1/models`.

    The capability tree is the reason this provider needs no per-model table:
    which thinking mode a model takes, and whether it still accepts sampling
    parameters, is published live and answers correctly for models released
    after this code was written.
    """

    model_config = ConfigDict(extra="allow")

    id: str
    display_name: str | None = None
    max_input_tokens: int | None = None
    max_tokens: int | None = None
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
