"""Reranker over any server serving a standard rerank shape."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.openai_compat import RERANK_DEFAULT_PATH, OpenAICompatClient, RerankShape
from app.retrieval.models import RerankCandidate, ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import (
    RerankScore,
    apply_rerank_scores,
    reported_rerank_usage,
    text_documents,
)
from app.schemas.chat_completions import RerankDocument
from app.schemas.usage import MeasuredUsage


class OpenAICompatReranker(Reranker):
    """Rerank candidates through a Jina/Cohere- or TEI-shaped endpoint."""

    def __init__(
        self,
        client: OpenAICompatClient,
        model_name: str,
        *,
        path: str = RERANK_DEFAULT_PATH,
        shape: RerankShape = RerankShape.JINA_COHERE,
    ) -> None:
        """Bind the reranker to a client, a model, and the endpoint's shape."""
        self._client = client
        self._path = path
        self._shape = shape
        self.model_name = model_name
        self._last_usage: MeasuredUsage | None = None

    @property
    def usage(self) -> MeasuredUsage | None:
        """Tokens the most recent rerank call reported, when the server states any."""
        return self._last_usage

    def rerank(self, query: str, candidates: Sequence[RerankCandidate]) -> Sequence[ScoredChunk]:
        """Return every candidate in provider-ranked order.

        A custom server is reached through a shape whose image form is
        not discoverable, so images are refused here; a provider known to
        serve them declares its own reranker.
        """
        self._last_usage = None
        if not candidates:
            return []
        texts = text_documents(candidates, provider="This server's")
        response = self._client.rerank(
            model=self.model_name,
            query=query,
            documents=[RerankDocument(text=text) for text in texts],
            path=self._path,
            shape=self._shape,
        )
        self._last_usage = reported_rerank_usage(response)
        scores = [
            RerankScore(index=result.index, score=result.relevance_score)
            for result in response.results
        ]
        return apply_rerank_scores(candidates, scores)
