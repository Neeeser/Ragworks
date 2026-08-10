"""Throttling proxies: every model request honors the connection's limits
and retries a transient provider failure before it fails a caller.

The connection's `max_concurrent_requests`/`requests_per_minute` settings
are holistic — chat, embedding, and reranking calls all draw from the same
per-connection window (see `app/providers/throttle.py`). These proxies are
how the non-chat surfaces join it: `ProviderResolver` wraps the embedders
and rerankers it hands to pipeline runs, and bulk chat callers outside the
LLM engine (eval generation) wrap their provider the same way. The LLM
engine slots its own calls directly, against the same keys, so everything
counts once. Retries run *inside* the held concurrency slot (never around
it), matching `connection_slot`'s own pacing rule: a full window must never
park more than `limit` threads sleeping out backoff.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.providers.chat.base import ChatProvider, ParsedChatResponse, ParsedStreamChunk
from app.providers.throttle import (
    RetryPolicy,
    call_with_retries,
    connection_slot,
    resolve_retry_policy,
)
from app.providers.usage_capture import UsageReporter, capture_chat
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk, EmbeddingVector, RerankCandidate, ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.schemas.media import InlineMedia
from app.schemas.models import ModelInfo
from app.schemas.usage import MeasuredUsage, usage_from_counters


class ThrottledEmbedder:
    """An embedder whose calls hold one of the connection's request slots
    and retry a transient provider failure before it fails the caller."""

    # The throttle triple, the retry policy, and the ledger reporter are
    # independent construction inputs; bundling them would hide the pacing
    # rule this proxy exists to apply.
    def __init__(  # noqa: PLR0913
        self,
        inner: Embedder,
        connection_id: UUID,
        *,
        limit: int,
        rpm: int | None,
        window: str = "shared",
        retry_policy: RetryPolicy | None = None,
        reporter: UsageReporter | None = None,
    ) -> None:
        """Wrap `inner`, throttled and retried against `connection_id`'s budget.

        `reporter` writes each call's reported tokens to the usage ledger;
        without one the proxy measures nothing, which is what a caller
        constructing an embedder outside a resolved connection wants.
        """
        self._inner = inner
        self._connection_id = connection_id
        self._limit = limit
        self._rpm = rpm
        self._window = window
        self._retry_policy = retry_policy or RetryPolicy()
        self._reporter = reporter
        # Plain attribute (not a property): the Embedder protocol declares a
        # settable `model_name`, and the id never changes after construction.
        self.model_name = inner.model_name

    def _record(self) -> None:
        """Ledger the tokens the call that just returned reported.

        Called outside the held slot: the write is a database round-trip, and
        measurement must not spend the concurrency and RPM budget it measures.
        """
        if self._reporter is not None:
            self._reporter.record(usage_from_counters(self._inner.usage))

    @property
    def usage(self) -> dict[str, int] | None:
        """Most recent embedding call's token usage, when reported."""
        return self._inner.usage

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed a chunk batch inside one throttled, retried request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            result = call_with_retries(
                lambda: self._inner.embed_documents(chunks), policy=self._retry_policy
            )
        self._record()
        return result

    def embed_images(self, images: Sequence[InlineMedia]) -> Sequence[EmbeddingVector]:
        """Embed images inside one throttled, retried request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            result = call_with_retries(
                lambda: self._inner.embed_images(images), policy=self._retry_policy
            )
        self._record()
        return result

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a query inside one throttled, retried request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            result = call_with_retries(
                lambda: self._inner.embed_query(query), policy=self._retry_policy
            )
        self._record()
        return result


class ThrottledReranker:
    """A reranker whose calls hold one of the connection's request slots
    and retry a transient provider failure before it fails the caller."""

    # Same independent construction inputs as ThrottledEmbedder above.
    def __init__(  # noqa: PLR0913
        self,
        inner: Reranker,
        connection_id: UUID,
        *,
        limit: int,
        rpm: int | None,
        window: str = "shared",
        retry_policy: RetryPolicy | None = None,
        reporter: UsageReporter | None = None,
    ) -> None:
        """Wrap `inner`, throttled and retried against `connection_id`'s budget."""
        self._inner = inner
        self._connection_id = connection_id
        self._limit = limit
        self._rpm = rpm
        self._window = window
        self._retry_policy = retry_policy or RetryPolicy()
        self._reporter = reporter

    @property
    def usage(self) -> MeasuredUsage | None:
        """The wrapped reranker's most recent reported spend."""
        return self._inner.usage

    def rerank(self, query: str, candidates: Sequence[RerankCandidate]) -> Sequence[ScoredChunk]:
        """Rerank inside one throttled, retried request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            result = call_with_retries(
                lambda: self._inner.rerank(query, candidates), policy=self._retry_policy
            )
        # Outside the slot: the ledger write must not hold the budget it measures.
        if self._reporter is not None:
            self._reporter.record(self._inner.usage)
        return result


class ThrottledChatProvider:
    """A chat provider whose non-streaming calls hold a request slot and
    retry a transient provider failure before they fail the caller.

    For bulk callers outside the LLM engine (eval generation). Streaming is
    passed through unthrottled *and* unretried: it serves interactive chat,
    where parking a user's turn behind a bulk run's exhausted window — or
    behind a retry's backoff sleep — trades a retryable error the user's own
    client can act on for a stall nothing explains.
    """

    def __init__(
        self,
        inner: ChatProvider,
        connection_id: UUID,
        *,
        limit: int,
        rpm: int | None,
        window: str = "shared",
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        """Wrap `inner`, throttled and retried against `connection_id`'s budget."""
        self._inner = inner
        self._connection_id = connection_id
        self._limit = limit
        self._rpm = rpm
        self._window = window
        self._retry_policy = retry_policy or RetryPolicy()
        # Plain attribute: the ChatProvider protocol declares a settable name.
        self.name = inner.name

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return provider model metadata when available."""
        return self._inner.get_model(model_id)

    def chat(self, request: Any) -> dict[str, Any]:
        """Complete a chat request inside one throttled, retried request slot."""
        with connection_slot(self._connection_id, self._limit, rpm=self._rpm, window=self._window):
            return call_with_retries(lambda: self._inner.chat(request), policy=self._retry_policy)

    def chat_stream(self, request: Any) -> Iterable[dict[str, Any]]:
        """Stream without throttling or retry (interactive path; see class docstring)."""
        return self._inner.chat_stream(request)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a non-streaming chat response payload."""
        return self._inner.parse_chat_response(response)

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming chunk payload."""
        return self._inner.parse_stream_chunk(chunk)


if TYPE_CHECKING:
    from app.providers.base import ProviderAdapter


def throttled_chat(
    adapter: ProviderAdapter,
    connection_id: UUID,
    *,
    retry_policy: RetryPolicy | None = None,
) -> ThrottledChatProvider:
    """A chat provider throttled and retried to the adapter's connection budget.

    The one-liner bulk chat callers (eval generation) use instead of
    re-deriving limits at every call site. `retry_policy` resolves once here
    (from app config) when the caller doesn't already hold one — this
    function is itself only ever called once per bulk run.
    """
    from app.schemas.enums import ProviderKind

    rpm, window = adapter.request_pace(ProviderKind.CHAT)
    return ThrottledChatProvider(
        capture_chat(adapter, connection_id),
        connection_id,
        limit=adapter.request_concurrency(),
        rpm=rpm,
        window=window,
        retry_policy=retry_policy or resolve_retry_policy(),
    )
