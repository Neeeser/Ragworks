"""Throttled-proxy retry behavior: embeddings, reranking, non-streaming chat.

Before this module, `ThrottledEmbedder`/`ThrottledReranker`/`ThrottledChatProvider`
held a connection slot but never retried -- a single 429 mid-ingestion
permanently failed the document. These pin that the retry layer is now wired
in at the throttled-proxy boundary, stays inside the held slot, and never
touches interactive streaming.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import httpx
import pytest

from app.providers.throttle import RetryPolicy
from app.providers.throttled import ThrottledChatProvider, ThrottledEmbedder, ThrottledReranker


@pytest.fixture(autouse=True)
def _no_real_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry backoff must never wait out real time in these tests."""
    monkeypatch.setattr("app.providers.throttle.time.sleep", lambda _: None)


def _http_status_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://provider.test/embed")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


class _FlakyEmbedder:
    """An inner embedder whose first N calls raise, then it succeeds."""

    model_name = "embed-1"
    usage: dict[str, int] | None = None

    def __init__(self, failures: list[Exception]) -> None:
        self._failures = list(failures)
        self.calls = 0

    def embed_documents(self, chunks: object) -> list[list[float]]:
        self.calls += 1
        if self._failures:
            raise self._failures.pop(0)
        return [[0.1, 0.2] for _ in chunks]  # type: ignore[union-attr]

    def embed_query(self, query: str) -> list[float]:
        self.calls += 1
        if self._failures:
            raise self._failures.pop(0)
        return [0.1, 0.2]


def test_embedder_429_once_then_succeeds() -> None:
    """The failure the report describes: one 429 mid-ingestion must not fail the document."""
    inner = _FlakyEmbedder([_http_status_error(429)])
    wrapped = ThrottledEmbedder(inner, uuid4(), limit=2, rpm=None)

    result = wrapped.embed_documents([object(), object()])

    assert result == [[0.1, 0.2], [0.1, 0.2]]
    assert inner.calls == 2  # one failed attempt, one retry


def test_embedder_400_is_not_retried() -> None:
    inner = _FlakyEmbedder([_http_status_error(400)])
    wrapped = ThrottledEmbedder(inner, uuid4(), limit=2, rpm=None)

    with pytest.raises(httpx.HTTPStatusError):
        wrapped.embed_documents([object()])
    assert inner.calls == 1  # no retry on a client error


def test_embedder_honors_a_configured_policy() -> None:
    """The resolved policy — not the hardcoded default — bounds the attempts."""
    inner = _FlakyEmbedder([_http_status_error(429), _http_status_error(429)])
    wrapped = ThrottledEmbedder(
        inner, uuid4(), limit=1, rpm=None, retry_policy=RetryPolicy(attempts=2)
    )

    with pytest.raises(httpx.HTTPStatusError):
        wrapped.embed_query("q")
    assert inner.calls == 2  # exhausted at 2 attempts, never reaching a 3rd


class _FlakyReranker:
    def __init__(self, failures: list[Exception]) -> None:
        self._failures = list(failures)
        self.calls = 0

    def rerank(self, query: str, candidates: object) -> object:
        self.calls += 1
        if self._failures:
            raise self._failures.pop(0)
        return candidates


def test_reranker_retries_a_503_then_succeeds() -> None:
    inner = _FlakyReranker([_http_status_error(503)])
    wrapped = ThrottledReranker(inner, uuid4(), limit=2, rpm=None)

    result = wrapped.rerank("q", ["c1"])

    assert result == ["c1"]
    assert inner.calls == 2


class _FlakyChatProvider:
    name = "stub"

    def __init__(self, failures: list[Exception]) -> None:
        self._failures = list(failures)
        self.calls = 0
        self.stream_calls = 0

    def get_model(self, model_id: str) -> Any:
        return None

    def chat(self, request: Any) -> dict[str, Any]:
        self.calls += 1
        if self._failures:
            raise self._failures.pop(0)
        return {"role": "assistant", "content": "ok"}

    def chat_stream(self, request: Any) -> Any:
        self.stream_calls += 1
        if self._failures:
            raise self._failures.pop(0)
        return iter(())

    def parse_chat_response(self, response: dict[str, Any]) -> Any:
        return response

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> Any:
        return chunk


def test_chat_retries_a_rate_limit_then_succeeds() -> None:
    inner = _FlakyChatProvider([_http_status_error(429)])
    wrapped = ThrottledChatProvider(inner, uuid4(), limit=2, rpm=None)

    result = wrapped.chat(object())

    assert result == {"role": "assistant", "content": "ok"}
    assert inner.calls == 2


def test_chat_stream_is_never_retried_or_throttled() -> None:
    """Interactive streaming stays unthrottled and unretried, by design.

    A 429 on the streaming path must surface immediately -- parking a user's
    turn behind a retry's backoff sleep is exactly the stall this design
    avoids for interactive chat.
    """
    inner = _FlakyChatProvider([_http_status_error(429)])
    wrapped = ThrottledChatProvider(inner, uuid4(), limit=2, rpm=None)

    with pytest.raises(httpx.HTTPStatusError):
        list(wrapped.chat_stream(object()))
    assert inner.stream_calls == 1  # no retry attempted
