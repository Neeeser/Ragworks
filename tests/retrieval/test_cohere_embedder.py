"""Behavior tests for the Cohere retrieval embedder."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest


def _chunks(*texts: str):
    """Build document chunks for embedding tests."""
    from app.retrieval.models import DocumentChunk

    return [
        DocumentChunk(chunk_id=f"doc:{index}", document_id="doc", order=index, text=text)
        for index, text in enumerate(texts)
    ]


def test_embedder_uses_document_and_query_input_types_with_dimension() -> None:
    """Documents and queries use the retrieval modes Cohere requires."""
    from app.clients.cohere.schemas import CohereEmbedResponse
    from app.retrieval.embedders.cohere_embedder import CohereEmbedder

    @dataclass
    class Client:
        calls: list[dict[str, Any]] = field(default_factory=list)

        def embed(self, texts: list[str], **kwargs: Any) -> CohereEmbedResponse:
            self.calls.append({"texts": texts, **kwargs})
            return CohereEmbedResponse.model_validate(
                {"embeddings": {"float": [[0.1, 0.2] for _ in texts]}}
            )

    client = Client()
    embedder = CohereEmbedder(client, "embed-v4.0", dimensions=1024)

    assert embedder.embed_documents(_chunks("one", "two")) == [[0.1, 0.2], [0.1, 0.2]]
    assert embedder.embed_query("question") == [0.1, 0.2]
    assert client.calls == [
        {"texts": ["one", "two"], "model": "embed-v4.0", "input_type": "search_document", "output_dimension": 1024},
        {"texts": ["question"], "model": "embed-v4.0", "input_type": "search_query", "output_dimension": 1024},
    ]


def test_embed_documents_batches_at_96_preserves_order_and_aggregates_usage() -> None:
    """Large ingestion batches respect Cohere's limit without losing order or usage."""
    from app.clients.cohere.schemas import CohereEmbedResponse
    from app.retrieval.embedders.cohere_embedder import CohereEmbedder

    @dataclass
    class Client:
        batch_sizes: list[int] = field(default_factory=list)

        def embed(self, texts: list[str], **_: Any) -> CohereEmbedResponse:
            self.batch_sizes.append(len(texts))
            return CohereEmbedResponse.model_validate(
                {
                    "embeddings": {
                        "float": [[float(text), float(text) + 0.5] for text in texts]
                    },
                    "meta": {"billed_units": {"input_tokens": len(texts)}},
                }
            )

    client = Client()
    embedder = CohereEmbedder(client, "embed-v4.0")

    vectors = embedder.embed_documents(_chunks(*(str(index) for index in range(205))))

    assert client.batch_sizes == [96, 96, 13]
    assert vectors == [[float(index), float(index) + 0.5] for index in range(205)]
    assert embedder.usage == {"prompt_tokens": 205, "total_tokens": 205}


def test_embed_documents_validates_each_batch_vector_count() -> None:
    """A malformed later Cohere batch fails at that batch boundary."""
    from app.clients.cohere.schemas import CohereEmbedResponse
    from app.retrieval.embedders.cohere_embedder import CohereEmbedder

    @dataclass
    class Client:
        calls: int = 0

        def embed(self, texts: list[str], **_: Any) -> CohereEmbedResponse:
            self.calls += 1
            count = len(texts) if self.calls == 1 else len(texts) - 1
            return CohereEmbedResponse.model_validate(
                {"embeddings": {"float": [[0.1] for _ in range(count)]}}
            )

    with pytest.raises(ValueError, match="mismatched"):
        CohereEmbedder(Client(), "embed-v4.0").embed_documents(
            _chunks(*(str(index) for index in range(97)))
        )
