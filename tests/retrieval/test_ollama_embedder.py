"""Behavior tests for OllamaEmbedder at the client boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from app.retrieval.embedders.ollama_embedder import OllamaEmbedder
from app.retrieval.models import DocumentChunk
from app.schemas.ollama import OllamaEmbedResponse


@dataclass
class _StubOllamaClient:
    response: OllamaEmbedResponse
    calls: list[dict[str, Any]] = field(default_factory=list)

    def embed(
        self,
        texts: list[str],
        model: str,
        dimensions: int | None = None,
    ) -> OllamaEmbedResponse:
        self.calls.append({"texts": texts, "model": model, "dimensions": dimensions})
        return self.response


def _chunks(*texts: str) -> list[DocumentChunk]:
    return [
        DocumentChunk(
            chunk_id=f"doc:{index}",
            document_id="doc",
            order=index,
            text=text,
            metadata={},
        )
        for index, text in enumerate(texts)
    ]


def test_embed_documents_returns_vectors_and_usage() -> None:
    client = _StubOllamaClient(
        OllamaEmbedResponse(embeddings=[[0.1, 0.2], [0.3, 0.4]], prompt_eval_count=7)
    )
    embedder = OllamaEmbedder(client, "nomic-embed-text")  # type: ignore[arg-type]

    vectors = embedder.embed_documents(_chunks("alpha", "beta"))
    assert vectors == [[0.1, 0.2], [0.3, 0.4]]
    assert embedder.usage == {"prompt_tokens": 7, "total_tokens": 7}
    assert client.calls[0]["texts"] == ["alpha", "beta"]
    assert client.calls[0]["dimensions"] is None


def test_embed_documents_rejects_mismatched_vector_count() -> None:
    client = _StubOllamaClient(OllamaEmbedResponse(embeddings=[[0.1]]))
    embedder = OllamaEmbedder(client, "nomic-embed-text")  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="mismatched"):
        embedder.embed_documents(_chunks("alpha", "beta"))


def test_embed_query_returns_first_vector() -> None:
    client = _StubOllamaClient(OllamaEmbedResponse(embeddings=[[0.5, 0.6]]))
    embedder = OllamaEmbedder(client, "nomic-embed-text", dimensions=2)  # type: ignore[arg-type]

    assert embedder.embed_query("hello") == [0.5, 0.6]
    assert client.calls[0]["dimensions"] == 2
