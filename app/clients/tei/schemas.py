"""Typed response shapes for Hugging Face Text Embeddings Inference."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TEIInfo(BaseModel):
    """Metadata returned by TEI's ``GET /info`` endpoint."""

    model_config = ConfigDict(extra="allow")

    model_id: str
    # TEI serializes this tagged union as e.g.
    # ``{"embedding": {"pooling": "mean"}}`` or ``{"reranker": {...}}``.
    model_type: dict[str, object]
    max_input_length: int | None = None


class TEIRerankResult(BaseModel):
    """One original input index and its relevance score from ``POST /rerank``."""

    model_config = ConfigDict(extra="allow")

    index: int
    score: float
