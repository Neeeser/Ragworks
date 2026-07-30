"""Schema models for chat/embedding model metadata."""

from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class ModelPricing(BaseModel):
    """Pricing details for a model."""

    prompt: str | None = None
    completion: str | None = None
    request: str | None = None


class ReasoningStyle(StrEnum):
    """How a provider is asked to let a model reason.

    `NONE` is the safe default — see `ChatCapabilities`. The two positive
    values differ on the wire, not in intent: OpenRouter's older models take
    a bare `include_reasoning` flag while everything else takes a structured
    block (`reasoning` on OpenAI/OpenRouter, `thinking` on Anthropic).
    """

    NONE = "none"
    BLOCK = "block"
    INCLUDE_FLAG = "include_flag"


class ChatCapabilities(BaseModel):
    """What a chat model can *do*, kept apart from the knobs it accepts.

    Sampling knobs (`supported_parameters`) and capabilities are different
    kinds of claim, and guessing wrong costs differently. Send a knob a model
    does not take and the provider answers naming the exact field, so the
    permissive dialect floor is right: a knob that might work beats a knob the
    user cannot reach. Guess a *capability* and the request itself is
    malformed — a reasoning block sent to a model with no reasoning is a hard
    400 with nothing for the user to change, and an assumed `tools` traps a
    retrieval chat on a model that can never call the tool.

    So capabilities default off and are only ever set from a provider's
    positive statement about that model. Never populate them from a dialect
    floor or an unknown-model fallback.
    """

    tools: bool = False
    reasoning: ReasoningStyle = ReasoningStyle.NONE
    #: Effort levels the provider publishes for this model. Empty means the
    #: provider names none — either it takes no effort level at all, or it
    #: never says — so no caller may invent one.
    reasoning_efforts: list[str] = Field(default_factory=list)


#: Names providers mix into a flat parameter list that are capability claims
#: rather than sampling knobs. Split out so one provider's habit of listing
#: them together cannot reach the knob filter.
CAPABILITY_MARKERS: frozenset[str] = frozenset({"tools", "reasoning", "include_reasoning"})


def split_capability_markers(
    parameters: Iterable[str],
) -> tuple[list[str], ChatCapabilities]:
    """Split a provider's flat parameter list into (knobs, capabilities)."""
    knobs: list[str] = []
    tools = False
    reasoning = ReasoningStyle.NONE
    for parameter in parameters:
        normalized = parameter.lower()
        if normalized == "tools":
            tools = True
        elif normalized == "reasoning":
            reasoning = ReasoningStyle.BLOCK
        elif normalized == "include_reasoning":
            # A model advertising both takes the structured block.
            if reasoning is ReasoningStyle.NONE:
                reasoning = ReasoningStyle.INCLUDE_FLAG
        else:
            knobs.append(parameter)
    return knobs, ChatCapabilities(tools=tools, reasoning=reasoning)


def normalize_capability_markers(model: Any) -> None:
    """Move capability markers out of a model's flat parameter list.

    Runs at construction so a provider that reports one flat list (OpenRouter,
    and any OpenAI-compatible server copying its shape) cannot leak `tools` or
    `reasoning` into the knob filter. A caller that states `capabilities`
    itself is authoritative and keeps them.
    """
    knobs, derived = split_capability_markers(model.supported_parameters)
    if "capabilities" not in model.model_fields_set:
        model.capabilities = derived
    model.supported_parameters = knobs


class ModelInfo(BaseModel):
    """Metadata about one chat model, however its provider publishes it."""

    id: str
    canonical_slug: str | None = None
    name: str
    description: str | None = None
    context_length: int | None = None
    architecture: dict[str, Any] = Field(default_factory=dict)
    pricing: ModelPricing | None = None
    #: Sampling knobs only — capability markers are split out on construction.
    supported_parameters: list[str] = Field(default_factory=list)
    top_provider: dict[str, Any] | None = None
    default_parameters: dict[str, Any] | None = None
    capabilities: ChatCapabilities = Field(default_factory=ChatCapabilities)

    @model_validator(mode="after")
    def _split_markers(self) -> ModelInfo:
        """Keep capability claims out of the sampling-knob list."""
        normalize_capability_markers(self)
        return self


class EmbeddingModelInfo(BaseModel):
    """Minimal metadata for embedding model listings."""

    id: str
    name: str
    description: str | None = None
    context_length: float | None = None
    max_input_tokens: int | None = None
    pricing: ModelPricing | None = None
    dimension: int | None = None


NumberLike = float | str


class ProviderEndpointPricing(BaseModel):
    """Per-endpoint pricing data reported by a provider."""

    prompt: NumberLike | None = None
    completion: NumberLike | None = None
    request: NumberLike | None = None
    image: NumberLike | None = None
    image_output: NumberLike | None = None
    audio: NumberLike | None = None
    input_audio_cache: NumberLike | None = None
    web_search: NumberLike | None = None
    internal_reasoning: NumberLike | None = None
    input_cache_read: NumberLike | None = None
    input_cache_write: NumberLike | None = None
    discount: float | None = None


class PublicEndpoint(BaseModel):
    """Public endpoint listing with pricing and status metadata."""

    name: str
    model_name: str | None = None
    context_length: float | None = None
    pricing: ProviderEndpointPricing | None = None
    provider_name: str | None = None
    tag: str | None = None
    quantization: dict[str, Any] | str | None = None
    max_completion_tokens: float | None = None
    max_prompt_tokens: float | None = None
    supported_parameters: list[str] = Field(default_factory=list)
    status: str | int | None = None
    uptime_last_30m: float | None = None
    supports_implicit_caching: bool | None = None


class ListEndpointsResponse(BaseModel):
    """Envelope for list endpoints API response."""

    id: str
    name: str
    created: float | None = None
    description: str | None = None
    architecture: dict[str, Any] = Field(default_factory=dict)
    endpoints: list[PublicEndpoint] = Field(default_factory=list)


class EndpointsListResponse(BaseModel):
    """Top-level response for endpoints list."""

    data: ListEndpointsResponse
