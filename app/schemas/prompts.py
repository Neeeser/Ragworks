"""Schema models for prompt templates."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel


class PromptVariable(BaseModel):
    """Template variable used in prompts."""

    name: str
    description: str
    example: Optional[str] = None


class PromptTemplateRead(BaseModel):
    """Prompt template data returned to clients."""

    template: str
    rendered: str
    context: Dict[str, str]
    variables: List[PromptVariable]
    is_custom: bool = False


class PromptTemplateUpdate(BaseModel):
    """Payload for updating a prompt template."""

    template: Optional[str] = None
