"""Behavior tests for Cohere's reranking adapter."""

from __future__ import annotations

from dataclasses import dataclass

import pytest


def _candidate(text: str, index: int):
    """Build one scored candidate chunk."""
    from app.retrieval.models import DocumentChunk, RerankCandidate, ScoredChunk

    return RerankCandidate(
        match=ScoredChunk(
            chunk=DocumentChunk(
                document_id="doc", chunk_id=f"chunk-{index}", text=text, order=index
            ),
            score=0.0,
        )
    )


def test_reranker_rejects_incomplete_cohere_response() -> None:
    """The downstream pipeline must never silently lose candidates."""
    from app.clients.cohere.schemas import CohereRerankResponse
    from app.retrieval.rerankers.cohere import CohereReranker

    @dataclass
    class Client:
        def rerank(self, **_: object) -> CohereRerankResponse:
            return CohereRerankResponse.model_validate(
                {"results": [{"index": 0, "relevance_score": 0.9}]}
            )

    with pytest.raises(ValueError, match="every candidate"):
        CohereReranker(Client(), "rerank-v4.0-fast").rerank(
            "query", [_candidate("a", 0), _candidate("b", 1)]
        )


def test_reranker_reports_the_search_units_cohere_billed() -> None:
    """Cohere states `meta.billed_units.search_units` and the ledger needs it.

    A parse dropping the block makes every rerank call look free.
    """
    from app.clients.cohere.schemas import CohereRerankResponse
    from app.retrieval.rerankers.cohere import CohereReranker
    from app.schemas.enums import UsageUnit

    @dataclass
    class Client:
        def rerank(self, **_: object) -> CohereRerankResponse:
            return CohereRerankResponse.model_validate(
                {
                    "results": [{"index": 0, "relevance_score": 0.9}],
                    "meta": {"api_version": {"version": "2"}, "billed_units": {"search_units": 1}},
                }
            )

    reranker = CohereReranker(Client(), "rerank-v4.0-fast")
    reranker.rerank("query", [_candidate("a", 0)])

    assert reranker.usage is not None
    assert (reranker.usage.quantity, reranker.usage.unit) == (1, UsageUnit.SEARCH_UNITS)
