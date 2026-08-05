"""Embeddings calls against any OpenAI-compatible endpoint."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.clients.openai_compat.transport import OpenAICompatTransport
from app.schemas.chat_completions import EmbeddingsResponse
from app.schemas.media import InlineMedia

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


def embed_media(
    transport: OpenAICompatTransport,
    media: Iterable[InlineMedia],
    *,
    model: str,
    dimensions: int | None = None,
    extra_headers: dict[str, str] | None = None,
) -> EmbeddingsResponse:
    """Embed inline media through the multimodal `input` form.

    A multimodal input entry is an object carrying a `content` array of
    typed parts rather than a bare string, which is how an
    OpenAI-compatible endpoint accepts an image. Models that serve only
    text reject it by name — the modality catalog is what keeps the call
    from being made against one.
    """
    inputs = [
        {"content": [{"type": "image_url", "image_url": {"url": item.data_uri()}}]}
        for item in media
    ]
    kwargs: dict[str, Any] = {
        "model": model,
        "input": inputs,
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
