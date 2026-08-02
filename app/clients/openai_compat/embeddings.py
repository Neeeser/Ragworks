"""Embeddings calls against any OpenAI-compatible endpoint."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.clients.openai_compat.transport import OpenAICompatTransport
from app.schemas.chat_completions import EmbeddingsResponse

#: Text sent to measure a model's output width when the server publishes none.
DIMENSION_PROBE_INPUT = "dimension_probe"


def embed(
    transport: OpenAICompatTransport,
    texts: Iterable[str],
    *,
    model: str,
    dimensions: int | None = None,
    extra_headers: dict[str, str] | None = None,
) -> EmbeddingsResponse:
    """Embed texts, sending `dimensions` only when the caller asked for one.

    Most embedding models reject an explicit `dimensions`, so it is omitted
    unless requested — the model's native width is what the indexer records.
    """
    kwargs: dict[str, Any] = {
        "model": model,
        "input": list(texts),
        "encoding_format": "float",
    }
    headers = transport.merge_headers(extra_headers)
    if headers:
        kwargs["extra_headers"] = headers
    if dimensions is not None:
        kwargs["dimensions"] = dimensions
    response = transport.sdk.embeddings.create(**kwargs)
    return EmbeddingsResponse.model_validate(response.model_dump())


def probe_embedding_dimension(transport: OpenAICompatTransport, model: str) -> int | None:
    """Measure a model's vector width with a single one-input call."""
    response = embed(transport, [DIMENSION_PROBE_INPUT], model=model)
    if not response.data:
        return None
    vector = response.data[0].embedding
    if not isinstance(vector, Iterable) or isinstance(vector, (str, bytes)):
        return None
    return len(list(vector))
