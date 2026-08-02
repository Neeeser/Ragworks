"""Cohere-backed reranker."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.cohere import CohereClient
from app.retrieval.models import ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import RerankScore, apply_rerank_scores


class CohereReranker(Reranker):
    """Rerank text candidates through Cohere's v2 reranking endpoint."""

    def __init__(self, client: CohereClient, model_name: str) -> None:
        """Bind one Cohere client and reranking model."""
        self._client = client
        self.model_name = model_name

    def rerank(self, query: str, candidates: Sequence[ScoredChunk]) -> Sequence[ScoredChunk]:
        """Return every candidate in the provider-ranked order."""
        if not candidates:
            return []
        response = self._client.rerank(
            model=self.model_name,
            query=query,
            documents=[candidate.chunk.text for candidate in candidates],
        )
        return apply_rerank_scores(
            candidates,
            [
                RerankScore(index=result.index, score=result.relevance_score)
                for result in response.results
            ],
        )
