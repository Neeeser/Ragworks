"""Embedding jobs are split to what the provider accepts per request.

A 699-chunk document is one `embed_documents` call, and OpenRouter refuses an
input array over 256 outright — the document fails to ingest with the
provider's own error. These pin the splitting wrapper's behavior and the
resolver wiring that puts it in front of every capped provider.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import ProviderConnectionRepository, UserRepository
from app.providers.batched import BatchedEmbedder
from app.providers.registry import ProviderResolver
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.schemas.enums import ProviderType
from app.schemas.media import InlineMedia


def _chunks(count: int) -> list[DocumentChunk]:
    """Build `count` distinguishable document chunks."""
    return [
        DocumentChunk(document_id="doc", chunk_id=f"doc:{index}", order=index, text=str(index))
        for index in range(count)
    ]


@dataclass
class _RecordingEmbedder:
    """An inner embedder that echoes one vector per input and reports usage."""

    model_name: str = "embed-1"
    batch_sizes: list[int] = field(default_factory=list)
    usage: dict[str, int] | None = None
    #: Vectors to return for the nth call, when the stub should misbehave.
    short_by: int = 0

    def embed_documents(self, chunks: Any) -> list[EmbeddingVector]:
        self.batch_sizes.append(len(chunks))
        self.usage = {"prompt_tokens": len(chunks), "total_tokens": len(chunks)}
        return [[float(chunk.text)] for chunk in chunks][: len(chunks) - self.short_by]

    def embed_images(self, images: Any) -> list[EmbeddingVector]:
        self.batch_sizes.append(len(images))
        self.usage = {"input_tokens": len(images)}
        return [[float(len(image.data))] for image in images]

    def embed_query(self, query: str) -> EmbeddingVector:
        self.batch_sizes.append(1)
        self.usage = {"prompt_tokens": 3, "total_tokens": 3}
        return [0.5]


def test_documents_split_into_provider_sized_batches_in_order() -> None:
    inner = _RecordingEmbedder()

    vectors = BatchedEmbedder(inner, 256).embed_documents(_chunks(699))

    assert inner.batch_sizes == [256, 256, 187]
    assert vectors == [[float(index)] for index in range(699)]


def test_usage_sums_across_sub_batches() -> None:
    """The inner embedder reports only its last request.

    Read straight through, a 699-chunk document would be billed as its final
    187-chunk batch — the run's token accounting silently loses the rest.
    """
    inner = _RecordingEmbedder()
    wrapped = BatchedEmbedder(inner, 256)

    wrapped.embed_documents(_chunks(699))

    assert wrapped.usage == {"prompt_tokens": 699, "total_tokens": 699}


def test_usage_resets_between_calls() -> None:
    inner = _RecordingEmbedder()
    wrapped = BatchedEmbedder(inner, 10)

    wrapped.embed_documents(_chunks(25))
    wrapped.embed_documents(_chunks(4))

    assert wrapped.usage == {"prompt_tokens": 4, "total_tokens": 4}


def test_a_sub_batch_returning_the_wrong_vector_count_fails() -> None:
    """Silently short vectors would misalign every chunk after the gap."""
    inner = _RecordingEmbedder(short_by=1)

    with pytest.raises(ValueError, match="returned 9 embeddings for a batch of 10"):
        BatchedEmbedder(inner, 10).embed_documents(_chunks(25))


def test_images_split_the_same_way() -> None:
    """Images go through the same endpoint, so the same input cap applies."""
    inner = _RecordingEmbedder()
    images = [InlineMedia(media_type="image/png", data=b"x" * (index + 1)) for index in range(7)]

    vectors = BatchedEmbedder(inner, 3).embed_images(images)

    assert inner.batch_sizes == [3, 3, 1]
    assert vectors == [[float(index + 1)] for index in range(7)]


def test_a_query_is_never_split() -> None:
    """One input is never over a cap, and splitting would change the question."""
    inner = _RecordingEmbedder()
    wrapped = BatchedEmbedder(inner, 1)

    assert wrapped.embed_query("what is a vector") == [0.5]
    assert inner.batch_sizes == [1]
    assert wrapped.usage == {"prompt_tokens": 3, "total_tokens": 3}


def test_an_empty_batch_never_reaches_the_provider() -> None:
    inner = _RecordingEmbedder()

    assert BatchedEmbedder(inner, 256).embed_documents([]) == []
    assert inner.batch_sizes == []


def test_a_size_below_one_is_refused() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        BatchedEmbedder(_RecordingEmbedder(), 0)


def _create_user(session: Session, email: str) -> models.User:
    repo = UserRepository(session)
    user = models.User(email=email, full_name="Example", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


@dataclass
class _StubOpenRouterClient:
    """Records the input-array size of every embeddings request."""

    batch_sizes: list[int] = field(default_factory=list)

    def embed(self, texts: Any, **_: Any) -> Any:
        from app.schemas.chat_completions import EmbeddingsResponse

        items = list(texts)
        self.batch_sizes.append(len(items))
        if len(items) > 256:
            raise AssertionError(
                f"Batch size {len(items)} exceeds maximum allowed batch size; maximum of 256"
            )
        return EmbeddingsResponse.model_validate(
            {
                "data": [{"embedding": [float(text)]} for text in items],
                "usage": {"prompt_tokens": len(items), "total_tokens": len(items)},
            }
        )


def test_a_699_chunk_document_reaches_openrouter_as_batches_of_256(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reported failure: one request carrying every chunk of a document."""
    client = _StubOpenRouterClient()
    monkeypatch.setattr(
        "app.providers.openrouter.get_openrouter_client", lambda *_args, **_kwargs: client
    )
    user = _create_user(session, "batching@example.com")
    connection = ProviderConnectionRepository(session).create(
        user_id=user.id,
        provider_type=ProviderType.OPENROUTER.value,
        label="OpenRouter",
        config={"api_key": "sk-or-test"},
    )
    session.commit()

    embedder = ProviderResolver(user, session).embedder(connection.id, "qwen/qwen3-embedding-0.6b")
    vectors = embedder.embed_documents(_chunks(699))

    assert client.batch_sizes == [256, 256, 187]
    assert vectors == [[float(index)] for index in range(699)]
    assert embedder.usage == {"prompt_tokens": 699, "total_tokens": 699}


def test_a_provider_with_no_known_cap_is_left_unbatched(session: Session) -> None:
    """`None` is "no documented cap", so nothing splits what the user sent."""
    user = _create_user(session, "uncapped@example.com")
    connection = ProviderConnectionRepository(session).create(
        user_id=user.id,
        provider_type=ProviderType.OLLAMA.value,
        label="Homelab",
        config={"base_url": "http://localhost:11434"},
    )
    session.commit()

    embedder = ProviderResolver(user, session).embedder(connection.id, "nomic-embed-text")

    assert not isinstance(embedder, BatchedEmbedder)


def test_a_custom_server_batches_at_the_operator_declared_cap() -> None:
    """Only the operator knows a self-hosted server's cap, so they state it."""
    from app.providers.custom import CustomAdapter

    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.CUSTOM.value,
        label="vLLM",
        config={"base_url": "http://localhost:8000", "max_embedding_inputs": 64},
    )

    adapter = CustomAdapter(connection)

    assert adapter.embedding_batch_size() == 64
    assert adapter.normalized_config()["max_embedding_inputs"] == 64


def test_a_tei_override_wins_over_the_servers_default_cap() -> None:
    from app.providers.tei import TEIAdapter

    default = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.TEI.value,
        label="TEI",
        config={"base_url": "http://localhost:8080"},
    )
    overridden = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.TEI.value,
        label="TEI",
        config={"base_url": "http://localhost:8080", "max_embedding_inputs": 512},
    )

    assert TEIAdapter(default).embedding_batch_size() == 32
    assert TEIAdapter(overridden).embedding_batch_size() == 512
