"""OpenRouter reranking adapter."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.openrouter import OpenRouterClient
from app.retrieval.models import RerankCandidate, ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import RerankScore, apply_rerank_scores
from app.schemas.chat_completions import RerankDocument


class OpenRouterReranker(Reranker):
    """Rerank candidates through OpenRouter's rerank API, images included."""

    def __init__(self, client: OpenRouterClient, model_name: str) -> None:
        self._client = client
        self.model_name = model_name

    def rerank(self, query: str, candidates: Sequence[RerankCandidate]) -> Sequence[ScoredChunk]:
        """Return every candidate in provider-ranked order.

        A candidate carrying an image is sent as the image: its stored
        text is a placeholder naming the file, so sending that instead
        would rank filenames. A model that cannot read images answers
        with OpenRouter's own error naming the document it refused.
        """
        if not candidates:
            return []
        response = self._client.rerank(
            model=self.model_name,
            query=query,
            documents=[_document(candidate) for candidate in candidates],
        )
        scores = [
            RerankScore(index=result.index, score=result.relevance_score)
            for result in response.results
        ]
        return apply_rerank_scores(candidates, scores)


def _document(candidate: RerankCandidate) -> RerankDocument:
    """Render one candidate as the document the endpoint scores."""
    if candidate.image is None:
        return RerankDocument(text=candidate.match.chunk.text)
    return RerankDocument(image=candidate.image.data_uri())
