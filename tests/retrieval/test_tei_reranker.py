"""Behavior tests for the TEI reranking adapter."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.clients.tei.schemas import TEIRerankResult
from app.retrieval.models import DocumentChunk, ScoredChunk
from app.retrieval.rerankers.tei import TEIReranker


def _candidate(text: str, index: int) -> ScoredChunk:
    return ScoredChunk(
        chunk=DocumentChunk(document_id="doc", chunk_id=f"chunk-{index}", text=text, order=index),
        score=0.1 * index,
    )


@dataclass
class _TEIClient:
    response: list[TEIRerankResult]
    calls: list[tuple[str, list[str]]] = field(default_factory=list)

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


def test_reranker_skips_empty_candidates_without_a_server_call() -> None:
    client = _TEIClient([])

    assert TEIReranker(client, "BAAI/bge-reranker-base").rerank("query", []) == []  # type: ignore[arg-type]
    assert client.calls == []
