"""Batching proxy: an embedding job is split to what the provider accepts.

A document arrives at the embedder node as one call carrying every chunk it
produced — hundreds for an ordinary PDF — and providers cap how many inputs
one embeddings request may carry (OpenRouter 256, OpenAI 2048, Cohere 96).
Over the cap the provider rejects the request outright, so the document fails
at ingestion with a provider error rather than embedding slowly.

`ProviderResolver.embedder` composes this *outside* `ThrottledEmbedder`, so
each sub-batch is a request in its own right: its own concurrency slot, its
own place in the RPM window, and its own retry on a transient failure.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TypeVar

from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector
from app.schemas.media import InlineMedia

InputT = TypeVar("InputT")


class BatchedEmbedder:
    """An embedder that splits document and image batches to a size cap.

    Queries pass through unsplit — one input is never over a cap, and
    cutting a query into parts would change what is being asked.
    """

    def __init__(self, inner: Embedder, size: int) -> None:
        """Wrap `inner`, sending at most `size` inputs per request."""
        if size < 1:
            raise ValueError("Embedding batch size must be at least 1.")
        self._inner = inner
        self._size = size
        self._usage: dict[str, int] | None = None
        # Plain attribute (not a property): the Embedder protocol declares a
        # settable `model_name`, and the id never changes after construction.
        self.model_name = inner.model_name

    @property
    def usage(self) -> dict[str, int] | None:
        """Token usage summed across the sub-batches of the last call.

        The inner embedder reports only its most recent request, so reading
        it straight through would bill a 699-chunk document as its final
        13-chunk batch.
        """
        return self._usage

    def _accumulate(self, reported: dict[str, int] | None) -> None:
        """Add one sub-batch's reported usage to the call's running total."""
        if reported is None:
            return
        total = dict(self._usage or {})
        for key, value in reported.items():
            total[key] = total.get(key, 0) + value
        self._usage = total

    def _run(
        self,
        items: Sequence[InputT],
        call: Callable[[Sequence[InputT]], Sequence[EmbeddingVector]],
    ) -> Sequence[EmbeddingVector]:
        """Embed `items` in order, one request per sub-batch."""
        self._usage = None
        if not items:
            return []
        vectors: list[EmbeddingVector] = []
        for start in range(0, len(items), self._size):
            batch = items[start : start + self._size]
            returned = call(batch)
            if len(returned) != len(batch):
                raise ValueError(
                    f"{self.model_name} returned {len(returned)} embeddings "
                    f"for a batch of {len(batch)} inputs."
                )
            vectors.extend(returned)
            self._accumulate(self._inner.usage)
        return vectors

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed chunks in provider-sized batches, preserving input order."""
        return self._run(chunks, self._inner.embed_documents)

    def embed_images(self, images: Sequence[InlineMedia]) -> Sequence[EmbeddingVector]:
        """Embed images in provider-sized batches, preserving input order."""
        return self._run(images, self._inner.embed_images)

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed one query — a single input needs no splitting."""
        self._usage = None
        vector = self._inner.embed_query(query)
        self._accumulate(self._inner.usage)
        return vector
