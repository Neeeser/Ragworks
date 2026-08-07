"""Behavior tests for the TEI reranking adapter."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app.clients.tei.schemas import TEIRerankResult
from app.retrieval.models import DocumentChunk, RerankCandidate, ScoredChunk
from app.retrieval.rerankers.tei import TEIReranker


def _candidate(text: str, index: int) -> RerankCandidate:
    return RerankCandidate(
        match=ScoredChunk(
            chunk=DocumentChunk(
                document_id="doc", chunk_id=f"chunk-{index}", text=text, order=index
            ),
            score=0.1 * index,
        )
    )


@dataclass
class _TEIClient:
    response: list[TEIRerankResult]
    served_model: str | None = None
    calls: list[tuple[str, list[str]]] = field(default_factory=list)

    def ensure_serves(self, model_name: str) -> None:
        if self.served_model is not None and self.served_model != model_name:
            raise ValueError(
                f"The TEI server now serves '{self.served_model}', not '{model_name}'."
            )

    def rerank(self, query: str, texts: list[str]) -> list[TEIRerankResult]:
        self.calls.append((query, texts))
        return self.response


def test_reranker_reorders_candidates_from_tei_indexed_scores() -> None:
    client = _TEIClient([TEIRerankResult(index=1, score=0.8), TEIRerankResult(index=0, score=0.2)])
    reranker = TEIReranker(client, "BAAI/bge-reranker-base")  # type: ignore[arg-type]

    ranked = reranker.rerank("query", [_candidate("alpha", 0), _candidate("beta", 1)])

    assert [(item.chunk.text, item.score) for item in ranked] == [
        ("beta", 0.8),
        ("alpha", 0.2),
    ]
    assert client.calls == [("query", ["alpha", "beta"])]


def test_reranker_aborts_before_scoring_when_served_model_changed() -> None:
    """Reranker scores carry no dimension check, so a swapped model must be caught.

    Regression: the served model was validated only at construction, so a TEI
    container restarted with a different --model-id silently returned scores
    from the wrong model.
    """
    client = _TEIClient(
        [TEIRerankResult(index=0, score=0.9)], served_model="BAAI/bge-reranker-large"
    )

    with pytest.raises(ValueError, match="now serves"):
        TEIReranker(client, "BAAI/bge-reranker-base").rerank(  # type: ignore[arg-type]
            "query", [_candidate("alpha", 0)]
        )
    assert client.calls == []


def test_reranker_skips_empty_candidates_without_a_server_call() -> None:
    client = _TEIClient([])

    assert TEIReranker(client, "BAAI/bge-reranker-base").rerank("query", []) == []  # type: ignore[arg-type]
    assert client.calls == []
