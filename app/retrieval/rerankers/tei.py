"""TEI-backed reranker."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.tei import TEIClient
from app.retrieval.models import ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import RerankScore, apply_rerank_scores


class TEIReranker(Reranker):
    """Rerank text candidates through a TEI classifier server."""

    def __init__(self, client: TEIClient, model_name: str) -> None:
        self._client = client
        self.model_name = model_name

    def rerank(
        self, query: str, candidates: Sequence[ScoredChunk]
    ) -> Sequence[ScoredChunk]:
        """Return every candidate in the order and scores supplied by TEI."""
        if not candidates:
            return []
        results = self._client.rerank(query, [candidate.chunk.text for candidate in candidates])
        scores = [RerankScore(index=result.index, score=result.score) for result in results]
        return apply_rerank_scores(candidates, scores)
