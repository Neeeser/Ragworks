from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, List

import pytest

from pydantic import ValidationError

from app.retrieval.embedders import openrouter_embedder as embedder_module
from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.retrieval.models import DocumentChunk


@dataclass
class StubOpenRouterClient:
    responses: List[dict[str, Any]]
    calls: list[dict[str, Any]] = field(default_factory=list)

    def embed(
        self,
        texts: Iterable[str],
        model: str | None = None,
        extra_headers: dict[str, str] | None = None,
        dimensions: int | None = None,
    ) -> dict[str, Any]:
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


def test_embed_documents_rejects_invalid_entries() -> None:
    payload = {"data": ["invalid"]}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    with pytest.raises(ValueError) as excinfo:
        embedder.embed_documents([_chunk("text", "chunk-0")])

    assert "invalid embedding entry" in str(excinfo.value)


def test_embed_documents_rejects_invalid_embedding_payload() -> None:
    payload = {"data": [{"embedding": "oops"}]}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    with pytest.raises(ValueError) as excinfo:
        embedder.embed_documents([_chunk("text", "chunk-0")])

    assert "without 'embedding' values" in str(excinfo.value)


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


def test_embed_documents_accepts_raw_dict_payload(monkeypatch) -> None:
    payload = {"data": [{"embedding": [0.1, 0.2]}]}
    client = StubOpenRouterClient(responses=[payload])
    embedder = OpenRouterEmbedder(client, "qwen/qwen3-embedding-0.6b")

    def _raise_validation_error(*_args, **_kwargs):
        raise ValidationError.from_exception_data("OpenRouterEmbeddingsResponse", [])

    monkeypatch.setattr(embedder_module.OpenRouterEmbeddingsResponse, "model_validate", _raise_validation_error)

    assert embedder.embed_documents([_chunk("text", "chunk-0")]) == [[0.1, 0.2]]
