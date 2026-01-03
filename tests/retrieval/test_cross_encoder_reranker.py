from __future__ import annotations

from typing import Any

import builtins
import importlib

import pytest

from app.retrieval.models import DocumentChunk, DocumentMetadata, ScoredChunk
from app.retrieval.rerankers import cross_encoder as reranker_module
from app.retrieval.rerankers.cross_encoder import CrossEncoderReranker


class _StubCrossEncoder:
    def __init__(self, _model_name: str, **_kwargs: Any) -> None:
        self.calls: list[list[tuple[str, str]]] = []

    def predict(self, pairs):
        materialized = list(pairs)
        self.calls.append(materialized)
        return [0.1, 0.9][: len(materialized)]


def _scored(text: str, score: float) -> ScoredChunk:
    chunk = DocumentChunk(
        document_id="doc-1",
        chunk_id=f"chunk-{text}",
        text=text,
        order=0,
        metadata=DocumentMetadata(),
    )
    return ScoredChunk(chunk=chunk, score=score)


def test_cross_encoder_reranks_and_applies_top_k(monkeypatch) -> None:
    monkeypatch.setattr(reranker_module, "CrossEncoder", _StubCrossEncoder)
    reranker = CrossEncoderReranker(model_name="unit-test")
    candidates = [_scored("alpha", 0.2), _scored("beta", 0.3)]

    reranked = reranker.rerank("query", candidates, top_k=1)

    assert len(reranked) == 1
    assert reranked[0].chunk.text == "beta"
    assert reranked[0].score == 0.9


def test_cross_encoder_returns_empty_when_no_candidates(monkeypatch) -> None:
    monkeypatch.setattr(reranker_module, "CrossEncoder", _StubCrossEncoder)
    reranker = CrossEncoderReranker(model_name="unit-test")

    assert reranker.rerank("query", []) == []


def test_cross_encoder_returns_all_when_top_k_missing(monkeypatch) -> None:
    monkeypatch.setattr(reranker_module, "CrossEncoder", _StubCrossEncoder)
    reranker = CrossEncoderReranker(model_name="unit-test")
    candidates = [_scored("alpha", 0.2), _scored("beta", 0.3)]

    reranked = reranker.rerank("query", candidates, top_k=None)

    assert len(reranked) == 2


def test_cross_encoder_raises_when_dependency_missing(monkeypatch) -> None:
    monkeypatch.setattr(reranker_module, "CrossEncoder", None)
    monkeypatch.setattr(reranker_module, "_IMPORT_ERROR", RuntimeError("missing"))

    with pytest.raises(RuntimeError, match="sentence-transformers is required"):
        CrossEncoderReranker(model_name="unit-test")


def test_cross_encoder_import_error_sets_module_state(monkeypatch) -> None:
    original_import = builtins.__import__

    def _failing_import(name: str, *args: Any, **kwargs: Any):
        if name.startswith("sentence_transformers"):
            raise ImportError("boom")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _failing_import)
    reloaded = importlib.reload(reranker_module)

    assert reloaded.CrossEncoder is None
    assert reloaded._IMPORT_ERROR is not None

    monkeypatch.setattr(builtins, "__import__", original_import)
    try:
        importlib.reload(reranker_module)
    except ImportError:
        pass
