"""Provider-backed reranker behavior tests."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app.retrieval.models import DocumentChunk, ScoredChunk
from app.retrieval.rerankers.openrouter import OpenRouterReranker
from app.schemas.openrouter import OpenRouterRerankResponse


def _candidate(text: str, index: int) -> ScoredChunk:
    return ScoredChunk(
        chunk=DocumentChunk(
            document_id="doc",
            chunk_id=f"chunk-{index}",
            text=text,
            order=index,
        ),
        score=0.1 * index,
    )


@dataclass
class _OpenRouterClient:
    payload: dict[str, object]
    calls: list[dict[str, object]] = field(default_factory=list)

    def rerank(
        self, *, model: str, query: str, documents: list[str]
    ) -> OpenRouterRerankResponse:
        self.calls.append({"model": model, "query": query, "documents": documents})
        return OpenRouterRerankResponse.model_validate(self.payload)


def test_openrouter_reranker_reorders_and_rescores_every_candidate() -> None:
    client = _OpenRouterClient(
        {
            "results": [
                {"index": 1, "relevance_score": 0.8},
                {"index": 0, "relevance_score": 0.2},
            ]
        }
    )
    reranker = OpenRouterReranker(client, "cohere/rerank-v3.5")

    ranked = reranker.rerank("query", [_candidate("alpha", 0), _candidate("beta", 1)])

    assert [(item.chunk.text, item.score) for item in ranked] == [
        ("beta", 0.8),
        ("alpha", 0.2),
    ]
    assert client.calls[0]["documents"] == ["alpha", "beta"]


def test_openrouter_reranker_sorts_unsorted_provider_results_by_score() -> None:
    reranker = OpenRouterReranker(
        _OpenRouterClient(
            {
                "results": [
                    {"index": 0, "relevance_score": 0.2},
                    {"index": 2, "relevance_score": 0.9},
                    {"index": 1, "relevance_score": 0.5},
                ]
            }
        ),
        "ranker",
    )

    ranked = reranker.rerank(
        "query",
        [_candidate("alpha", 0), _candidate("beta", 1), _candidate("gamma", 2)],
    )

    assert [(item.chunk.text, item.score) for item in ranked] == [
        ("gamma", 0.9),
        ("beta", 0.5),
        ("alpha", 0.2),
    ]


def test_openrouter_reranker_stable_ties_follow_original_candidate_order() -> None:
    reranker = OpenRouterReranker(
        _OpenRouterClient(
            {
                "results": [
                    {"index": 2, "relevance_score": 0.8},
                    {"index": 1, "relevance_score": 0.8},
                    {"index": 0, "relevance_score": 0.1},
                ]
            }
        ),
        "ranker",
    )

    ranked = reranker.rerank(
        "query",
        [_candidate("alpha", 0), _candidate("beta", 1), _candidate("gamma", 2)],
    )

    assert [(item.chunk.text, item.score) for item in ranked] == [
        ("beta", 0.8),
        ("gamma", 0.8),
        ("alpha", 0.1),
    ]


@pytest.mark.parametrize(
    ("results", "message"),
    [
        ([{"index": 0, "relevance_score": 0.8}], "every candidate"),
        (
            [
                {"index": 0, "relevance_score": 0.8},
                {"index": 0, "relevance_score": 0.2},
            ],
            "duplicate",
        ),
        (
            [
                {"index": 0, "relevance_score": 0.8},
                {"index": 3, "relevance_score": 0.2},
            ],
            "out-of-range",
        ),
        (
            [
                {"index": 0, "relevance_score": 0.8},
                {"index": 1, "relevance_score": "NaN"},
            ],
            "finite",
        ),
    ],
)
def test_openrouter_reranker_rejects_incomplete_or_invalid_results(
    results: list[dict[str, object]], message: str
) -> None:
    reranker = OpenRouterReranker(_OpenRouterClient({"results": results}), "ranker")

    with pytest.raises(ValueError, match=message):
        reranker.rerank("query", [_candidate("alpha", 0), _candidate("beta", 1)])


def test_openrouter_reranker_skips_empty_candidate_sets() -> None:
    client = _OpenRouterClient({"results": []})

    assert OpenRouterReranker(client, "ranker").rerank("query", []) == []
    assert client.calls == []
