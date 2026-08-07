"""Provider-backed reranker behavior tests."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app.retrieval.models import DocumentChunk, RerankCandidate, ScoredChunk
from app.retrieval.rerankers.cohere import CohereReranker
from app.retrieval.rerankers.openrouter import OpenRouterReranker
from app.retrieval.rerankers.tei import TEIReranker
from app.schemas.chat_completions import RerankDocument, RerankResponse
from app.schemas.media import InlineMedia
from app.services.errors import InvalidInputError


def _candidate(text: str, index: int, *, image: InlineMedia | None = None) -> RerankCandidate:
    return RerankCandidate(
        match=ScoredChunk(
            chunk=DocumentChunk(
                document_id="doc",
                chunk_id=f"chunk-{index}",
                text=text,
                order=index,
            ),
            score=0.1 * index,
        ),
        image=image,
    )


@dataclass
class _OpenRouterClient:
    payload: dict[str, object]
    calls: list[dict[str, object]] = field(default_factory=list)

    def rerank(
        self, *, model: str, query: str, documents: list[RerankDocument]
    ) -> RerankResponse:
        self.calls.append({"model": model, "query": query, "documents": documents})
        return RerankResponse.model_validate(self.payload)


class _TextOnlyClient:
    """Stands in for Cohere/TEI: reached only if the refusal never happens."""

    def rerank(self, *args: object, **kwargs: object) -> RerankResponse:
        raise AssertionError("a text-only endpoint must not be called with images")

    def ensure_serves(self, model: str) -> None:
        del model


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
    assert client.calls[0]["documents"] == [
        RerankDocument(text="alpha"),
        RerankDocument(text="beta"),
    ]


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


def test_openrouter_reranker_sends_the_image_an_image_candidate_stands_for() -> None:
    """An image chunk is scored as the picture, never as its placeholder text.

    A chunk carrying only an image is stored under a derived string naming
    the file, so sending that is asking the model to rank filenames.
    """
    client = _OpenRouterClient(
        {
            "results": [
                {"index": 0, "relevance_score": 0.4},
                {"index": 1, "relevance_score": 0.9},
            ]
        }
    )
    reranker = OpenRouterReranker(client, "nvidia/llama-nemotron-rerank-vl-1b-v2")
    page = _candidate(
        "[image: page-12.jpg]",
        1,
        image=InlineMedia(media_type="image/png", data=b"\x89PNG-bytes"),
    )

    ranked = reranker.rerank("what does the chart show?", [_candidate("alpha", 0), page])

    documents = client.calls[0]["documents"]
    assert documents == [
        RerankDocument(text="alpha"),
        RerankDocument(image="data:image/png;base64,iVBORy1ieXRlcw=="),
    ]
    assert [item.chunk.chunk_id for item in ranked] == ["chunk-1", "chunk-0"]


@pytest.mark.parametrize(
    ("build", "provider"),
    [
        (
            lambda: CohereReranker(_TextOnlyClient(), "rerank-v3.5"),
            "Cohere",
        ),
        (
            lambda: TEIReranker(_TextOnlyClient(), "bge-reranker"),
            "TEI",
        ),
    ],
)
def test_text_only_rerankers_refuse_images_instead_of_ranking_placeholders(
    build: object, provider: str
) -> None:
    """A text-only endpoint says so rather than scoring the filename.

    Cohere's `/v2/rerank` and TEI both take strings only, and a plausible
    ordering over placeholder text is the failure that hides itself.
    """
    reranker = build()  # type: ignore[operator]
    page = _candidate(
        "[image: page-12.jpg]",
        1,
        image=InlineMedia(media_type="image/png", data=b"bytes"),
    )

    with pytest.raises(InvalidInputError, match=provider):
        reranker.rerank("query", [_candidate("alpha", 0), page])
