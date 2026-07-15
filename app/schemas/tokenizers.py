"""HuggingFace tokenizer cache API models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HuggingFaceTokenizerDownload(BaseModel):
    """Consent and repository id for one tokenizer JSON download."""

    model_id: str = Field(min_length=1)
    consent: bool = False
    remember: bool = False


class HuggingFaceTokenizerRead(BaseModel):
    """Confirmation that a tokenizer JSON file is cached locally."""

    model_id: str
    cached: bool = True
