from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.retrieval.models import DocumentChunk
from app.schemas.openrouter import OpenRouterEmbeddingsResponse
from app.services.errors import ExternalServiceError


@dataclass
class StubOpenRouterClient:
    responses: list[dict[str, Any]]
    calls: list[dict[str, Any]] = field(default_factory=list)

    def embed(
        self,
        texts: Iterable[str],
        model: str | None = None,
        extra_headers: dict[str, str] | None = None,
        dimensions: int | None = None,
    ) -> OpenRouterEmbeddingsResponse:
        self.calls.append(
            {
                "texts": list(texts),
                "model": model,
                "extra_headers": extra_headers,
                "dimensions": dimensions,
            }
        )
        if not self.responses:
            raise AssertionError("No stub responses remaining for embed call.")
        return OpenRouterEmbeddingsResponse.model_validate(self.responses.pop(0))


def _chunk(text: str, chunk_id: str) -> DocumentChunk:
    return DocumentChunk(
        document_id="doc-123",
        chunk_id=chunk_id,
        text=text,
        order=int(chunk_id.split("-")[-1]),
    )


def test_embed_documents_returns_vectors_and_usage() -> None:
    payload = {
        "data": [
            {"embedding": [0.1, 0.2, 0.3]},
            {"embedding": [0.4, 0.5, 0.6]},
        ],
        "usage": {"prompt_tokens": 12, "total_tokens": 12},
    }
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    result = embedder.embed_documents([_chunk("hello world", "chunk-0"), _chunk("second chunk", "chunk-1")])

    assert result == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
    assert embedder.usage == {"prompt_tokens": 12, "total_tokens": 12}
    assert client.calls[0]["texts"] == ["hello world", "second chunk"]


def test_embed_documents_raises_when_payload_missing_data() -> None:
    """No data and no error envelope: an internal contract violation, not a 502."""
    payload = {"data": None}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    with pytest.raises(ValueError, match="without a 'data' array"):
        embedder.embed_documents([_chunk("text", "chunk-0")])


def test_embed_documents_rejects_invalid_embedding_payload() -> None:
    payload = {"data": [{"embedding": "oops"}]}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    with pytest.raises(ValueError, match="without 'embedding' values"):
        embedder.embed_documents([_chunk("text", "chunk-0")])


def test_embed_query_returns_empty_when_no_vectors() -> None:
    payload = {"data": []}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    assert embedder.embed_query("query") == []


def test_embed_documents_sets_usage_from_payload() -> None:
    payload = {"data": [{"embedding": [0.1]}], "usage": {"prompt_tokens": 1.5, "total_tokens": 2}}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    embedder.embed_documents([_chunk("text", "chunk-0")])

    assert embedder.usage == {"prompt_tokens": 1, "total_tokens": 2}


def test_embed_documents_short_circuits_on_empty_chunks() -> None:
    client = StubOpenRouterClient(responses=[])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    assert embedder.embed_documents([]) == []




def test_embed_documents_surfaces_provider_error_envelope() -> None:
    """Regression: a provider error envelope (no `data`) used to raise a bare
    ValueError that reached the API as a 500; it must surface as the external
    failure it is, carrying the provider's message."""
    payload = {
        "error": {
            "message": 'HTTP 400: Model "x" does not support matryoshka representation',
            "code": 400,
        }
    }
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "baai/bge-base-en-v1.5", dimensions=768)

    with pytest.raises(ExternalServiceError, match="matryoshka"):
        embedder.embed_documents([_chunk("text", "chunk-0")])
