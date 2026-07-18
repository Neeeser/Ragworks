"""OpenRouter reranking adapter."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.openrouter import OpenRouterClient
from app.retrieval.models import ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import RerankScore, apply_rerank_scores


class OpenRouterReranker(Reranker):
    """Rerank text candidates through OpenRouter's rerank API."""

    def __init__(self, client: OpenRouterClient, model_name: str) -> None:
        self._client = client
        self.model_name = model_name

    def rerank(
        self, query: str, candidates: Sequence[ScoredChunk]
    ) -> Sequence[ScoredChunk]:
        """Return every candidate in provider-ranked order."""
        if not candidates:
            return []
        response = self._client.rerank(
            model=self.model_name,
            query=query,
            documents=[candidate.chunk.text for candidate in candidates],
        )
        scores = [
            RerankScore(index=result.index, score=result.relevance_score)
            for result in response.results
        ]
        return apply_rerank_scores(candidates, scores)
