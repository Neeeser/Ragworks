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
