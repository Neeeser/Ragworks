from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ModelPricing(BaseModel):
    prompt: Optional[str] = None
    completion: Optional[str] = None
    request: Optional[str] = None


class ModelInfo(BaseModel):
    id: str
    canonical_slug: Optional[str] = None
    name: str
    description: Optional[str] = None
    context_length: Optional[int] = None
    architecture: Dict[str, Any] = Field(default_factory=dict)
    pricing: Optional[ModelPricing] = None
    supported_parameters: List[str] = Field(default_factory=list)
    top_provider: Optional[Dict[str, Any]] = None
    default_parameters: Optional[Dict[str, Any]] = None


NumberLike = float | str


class ProviderEndpointPricing(BaseModel):
    prompt: Optional[NumberLike] = None
    completion: Optional[NumberLike] = None
    request: Optional[NumberLike] = None
    image: Optional[NumberLike] = None
    image_output: Optional[NumberLike] = None
    audio: Optional[NumberLike] = None
    input_audio_cache: Optional[NumberLike] = None
    web_search: Optional[NumberLike] = None
    internal_reasoning: Optional[NumberLike] = None
    input_cache_read: Optional[NumberLike] = None
    input_cache_write: Optional[NumberLike] = None
    discount: Optional[float] = None


class PublicEndpoint(BaseModel):
    name: str
    model_name: Optional[str] = None
    context_length: Optional[float] = None
    pricing: Optional[ProviderEndpointPricing] = None
    provider_name: Optional[str] = None
    tag: Optional[str] = None
    quantization: Optional[Dict[str, Any] | str] = None
    max_completion_tokens: Optional[float] = None
    max_prompt_tokens: Optional[float] = None
    supported_parameters: List[str] = Field(default_factory=list)
    status: Optional[str | int] = None
    uptime_last_30m: Optional[float] = None
    supports_implicit_caching: Optional[bool] = None


class ListEndpointsResponse(BaseModel):
    id: str
    name: str
    created: Optional[float] = None
    description: Optional[str] = None
    architecture: Dict[str, Any] = Field(default_factory=dict)
    endpoints: List[PublicEndpoint] = Field(default_factory=list)


class EndpointsListResponse(BaseModel):
    data: ListEndpointsResponse
