"""Cohere-backed reranker."""

from __future__ import annotations

from collections.abc import Sequence

from app.clients.cohere import CohereClient
from app.retrieval.models import RerankCandidate, ScoredChunk
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.results import RerankScore, apply_rerank_scores, text_documents
from app.schemas.usage import MeasuredUsage, search_unit_usage


class CohereReranker(Reranker):
    """Rerank text candidates through Cohere's v2 reranking endpoint."""

    def __init__(self, client: CohereClient, model_name: str) -> None:
        """Bind one Cohere client and reranking model."""
        self._client = client
        self.model_name = model_name
        self._last_usage: MeasuredUsage | None = None

    @property
    def usage(self) -> MeasuredUsage | None:
        """Search units billed by the most recent rerank call, when stated."""
        return self._last_usage

    def rerank(self, query: str, candidates: Sequence[RerankCandidate]) -> Sequence[ScoredChunk]:
        """Return every candidate in the provider-ranked order.

        Cohere's `/v2/rerank` takes a list of strings and serves no image
        form on any rerank model, so an image candidate is refused rather
        than scored by the placeholder text it is stored under.
        """
        self._last_usage = None
        if not candidates:
            return []
        response = self._client.rerank(
            model=self.model_name,
            query=query,
            documents=text_documents(candidates, provider="Cohere"),
        )
        billed = response.meta.billed_units if response.meta else None
        self._last_usage = search_unit_usage(billed.search_units if billed else None)
        return apply_rerank_scores(
            candidates,
            [
                RerankScore(index=result.index, score=result.relevance_score)
                for result in response.results
            ],
        )
