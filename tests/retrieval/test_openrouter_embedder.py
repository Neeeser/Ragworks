from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, List

import pytest

from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.retrieval.models import DocumentChunk


@dataclass
class StubOpenRouterClient:
    responses: List[dict[str, Any]]
    calls: list[dict[str, Any]] = field(default_factory=list)

    def embed(self, texts: Iterable[str], model: str | None = None, extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
        self.calls.append({"texts": list(texts), "model": model, "extra_headers": extra_headers})
        if not self.responses:
            raise AssertionError("No stub responses remaining for embed call.")
        return self.responses.pop(0)


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
    payload = {"data": None, "error": {"message": "model unavailable"}}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    with pytest.raises(ValueError) as excinfo:
        embedder.embed_documents([_chunk("text", "chunk-0")])

    assert "without a 'data' array" in str(excinfo.value)
