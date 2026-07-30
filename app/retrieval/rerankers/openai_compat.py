"""Reranker over any server serving a standard rerank shape."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.openai_compat import RERANK_DEFAULT_PATH, OpenAICompatClient, RerankShape
from app.retrieval.models import ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import RerankScore, apply_rerank_scores


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
            path=self._path,
            shape=self._shape,
        )
        scores = [
            RerankScore(index=result.index, score=result.relevance_score)
            for result in response.results
        ]
        return apply_rerank_scores(candidates, scores)
