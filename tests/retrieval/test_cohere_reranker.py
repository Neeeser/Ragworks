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
