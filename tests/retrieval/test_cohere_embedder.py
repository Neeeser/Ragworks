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


def test_cohere_declares_its_96_input_cap_for_the_shared_batcher() -> None:
    """Cohere's per-request limit is enforced by `BatchedEmbedder`, from here."""
    from uuid import uuid4

    from app.db import models
    from app.providers.cohere import CohereAdapter
    from app.schemas.enums import ProviderType

    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.COHERE.value,
        label="Cohere",
        config={"api_key": "co-test"},
    )

    assert CohereAdapter(connection).embedding_batch_size() == 96


def test_embed_documents_validates_the_returned_vector_count() -> None:
    """Short vectors would misalign every chunk after the gap."""
    from app.clients.cohere.schemas import CohereEmbedResponse
    from app.retrieval.embedders.cohere_embedder import CohereEmbedder

    @dataclass
    class Client:
        def embed(self, texts: list[str], **_: Any) -> CohereEmbedResponse:
            return CohereEmbedResponse.model_validate(
                {"embeddings": {"float": [[0.1] for _ in range(len(texts) - 1)]}}
            )

    with pytest.raises(ValueError, match="mismatched"):
        CohereEmbedder(Client(), "embed-v4.0").embed_documents(_chunks("a", "b", "c"))


def test_embedder_sends_one_request_per_image_and_sums_usage() -> None:
    """Cohere's per-call image limit differs by model generation.

    The API publishes no way to ask which limit applies, so the batch size
    that is always valid is one — and usage then has to be summed across the
    requests the way the batched text path sums its batches.
    """
    from app.clients.cohere.schemas import CohereEmbedResponse
    from app.retrieval.embedders.cohere_embedder import CohereEmbedder
    from app.schemas.media import InlineMedia

    @dataclass
    class Client:
        calls: list[dict[str, Any]] = field(default_factory=list)

        def embed_image(self, media: InlineMedia, **kwargs: Any) -> CohereEmbedResponse:
            self.calls.append({"media_type": media.media_type, **kwargs})
            return CohereEmbedResponse.model_validate(
                {
                    "embeddings": {"float": [[0.9, 0.8]]},
                    "meta": {"billed_units": {"input_tokens": 7}},
                }
            )

    client = Client()
    embedder = CohereEmbedder(client, "embed-v4.0", dimensions=1024)
    images = [
        InlineMedia(media_type="image/png", data=b"one"),
        InlineMedia(media_type="image/jpeg", data=b"two"),
    ]

    assert embedder.embed_images(images) == [[0.9, 0.8], [0.9, 0.8]]
    assert client.calls == [
        {"media_type": "image/png", "model": "embed-v4.0", "output_dimension": 1024},
        {"media_type": "image/jpeg", "model": "embed-v4.0", "output_dimension": 1024},
    ]
    assert embedder.usage == {"input_tokens": 14}


def test_embedder_embeds_no_images_without_calling_the_provider() -> None:
    from app.retrieval.embedders.cohere_embedder import CohereEmbedder

    @dataclass
    class Client:
        calls: list[Any] = field(default_factory=list)

        def embed_image(self, *args: Any, **kwargs: Any) -> Any:
            self.calls.append(args)
            raise AssertionError("should not be called")

    client = Client()
    assert CohereEmbedder(client, "embed-v4.0").embed_images([]) == []
    assert client.calls == []
