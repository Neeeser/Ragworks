"""Throttling proxies: every model request honors the connection's limits.

The connection's `max_concurrent_requests`/`requests_per_minute` settings
are holistic — chat, embedding, and reranking calls all draw from the same
per-connection window (see `app/providers/throttle.py`). These proxies are
how the non-chat surfaces join it: `ProviderResolver` wraps the embedders
and rerankers it hands to pipeline runs, and bulk chat callers outside the
LLM engine (eval generation) wrap their provider the same way. The LLM
engine slots its own calls directly, against the same keys, so everything
counts once.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.providers.chat.base import ChatProvider, ParsedChatResponse, ParsedStreamChunk
from app.providers.throttle import connection_slot
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector, ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.schemas.models import ModelInfo


class ThrottledEmbedder:
    """An embedder whose calls hold one of the connection's request slots."""

    def __init__(
        self,
        inner: Embedder,
        connection_id: UUID,
        *,
        limit: int,
        rpm: int | None,
        window: str = "shared",
    ) -> None:
        """Wrap `inner`, throttled against `connection_id`'s budget."""
        self._inner = inner
        self._connection_id = connection_id
        self._limit = limit
        self._rpm = rpm
        self._window = window
        # Plain attribute (not a property): the Embedder protocol declares a
        # settable `model_name`, and the id never changes after construction.
        self.model_name = inner.model_name

    @property
    def usage(self) -> dict[str, int] | None:
        """Most recent embedding call's token usage, when reported."""
        return self._inner.usage

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed a chunk batch inside one throttled request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            return self._inner.embed_documents(chunks)

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a query inside one throttled request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            return self._inner.embed_query(query)


class ThrottledReranker:
    """A reranker whose calls hold one of the connection's request slots."""

    def __init__(
        self,
        inner: Reranker,
        connection_id: UUID,
        *,
        limit: int,
        rpm: int | None,
        window: str = "shared",
    ) -> None:
        """Wrap `inner`, throttled against `connection_id`'s budget."""
        self._inner = inner
        self._connection_id = connection_id
        self._limit = limit
        self._rpm = rpm
        self._window = window

    def rerank(self, query: str, candidates: Sequence[ScoredChunk]) -> Sequence[ScoredChunk]:
        """Rerank inside one throttled request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            return self._inner.rerank(query, candidates)


class ThrottledChatProvider:
    """A chat provider whose non-streaming calls hold a request slot.

    For bulk callers outside the LLM engine (eval generation). Streaming is
    passed through unthrottled: it serves interactive chat, where parking a
    user's turn behind a bulk run's exhausted window trades a rate-limit
    error the retry layer already handles for a stall nothing explains.
    """

    def __init__(
        self,
        inner: ChatProvider,
        connection_id: UUID,
        *,
        limit: int,
        rpm: int | None,
        window: str = "shared",
    ) -> None:
        """Wrap `inner`, throttled against `connection_id`'s budget."""
        self._inner = inner
        self._connection_id = connection_id
        self._limit = limit
        self._rpm = rpm
        self._window = window
        # Plain attribute: the ChatProvider protocol declares a settable name.
        self.name = inner.name

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return provider model metadata when available."""
        return self._inner.get_model(model_id)

    def chat(self, request: Any) -> dict[str, Any]:
        """Complete a chat request inside one throttled request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            return self._inner.chat(request)

    def chat_stream(self, request: Any) -> Iterable[dict[str, Any]]:
        """Stream without throttling (interactive path; see class docstring)."""
        return self._inner.chat_stream(request)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a non-streaming chat response payload."""
        return self._inner.parse_chat_response(response)

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming chunk payload."""
        return self._inner.parse_stream_chunk(chunk)


if TYPE_CHECKING:
    from app.providers.base import ProviderAdapter


def throttled_chat(adapter: ProviderAdapter, connection_id: UUID) -> ThrottledChatProvider:
    """A chat provider throttled to the adapter's connection budget.

    The one-liner bulk chat callers (eval generation) use instead of
    re-deriving limits at every call site.
    """
    from app.schemas.enums import ProviderKind

    rpm, window = adapter.request_pace(ProviderKind.CHAT)
    return ThrottledChatProvider(
        adapter.chat_provider(),
        connection_id,
        limit=adapter.request_concurrency(),
        rpm=rpm,
        window=window,
    )
