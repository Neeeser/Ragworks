"""Cross-encoder based reranking implementation."""

from __future__ import annotations

from typing import Sequence

from ..models import ScoredChunk
from .base import Reranker

try:
    from sentence_transformers import CrossEncoder as SENTENCE_TRANSFORMERS_CROSS_ENCODER
except Exception as exc:  # pylint: disable=broad-except
    SENTENCE_TRANSFORMERS_CROSS_ENCODER = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None

CrossEncoder = SENTENCE_TRANSFORMERS_CROSS_ENCODER


class CrossEncoderReranker(Reranker):  # pylint: disable=too-few-public-methods
    """Cross-encoder reranker that scores candidate chunks against the query."""

    def __init__(
        self,
        model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
        **model_kwargs: object,
    ) -> None:
        """Initialize the reranker with the given model name."""
        if CrossEncoder is None:
            raise RuntimeError(
                "sentence-transformers is required for cross-encoder reranking."
            ) from _IMPORT_ERROR
        self._model = CrossEncoder(model_name, **model_kwargs)

    def rerank(
        self,
        query: str,
        candidates: Sequence[ScoredChunk],
        top_k: int | None = None,
    ) -> Sequence[ScoredChunk]:
        """Return reranked chunks scored by the cross-encoder."""
        if not candidates:
            return []

        pairs = [(query, scored.chunk.text) for scored in candidates]
        scores = self._model.predict(pairs)
        reranked = [
            ScoredChunk(chunk=scored.chunk, score=float(score))
            for scored, score in zip(candidates, scores)
        ]
        reranked.sort(key=lambda item: item.score, reverse=True)
        if top_k is not None:
            return reranked[:top_k]
        return reranked
