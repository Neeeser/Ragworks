"""Schema models for OpenRouter model metadata."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ModelPricing(BaseModel):
    """Pricing details for a model."""

    prompt: str | None = None
    completion: str | None = None
    request: str | None = None


class ModelInfo(BaseModel):
    """Metadata about a model available from OpenRouter."""

    id: str
    canonical_slug: str | None = None
    name: str
    description: str | None = None
    context_length: int | None = None
    architecture: dict[str, Any] = Field(default_factory=dict)
    pricing: ModelPricing | None = None
    supported_parameters: list[str] = Field(default_factory=list)
    top_provider: dict[str, Any] | None = None
    default_parameters: dict[str, Any] | None = None


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
