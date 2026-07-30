"""Reranking calls against any server speaking a standard rerank shape.

Two request shapes cover the field. The **Jina/Cohere** shape
(`{model, query, documents, top_n}` → `{"results": [{index, relevance_score}]}`)
is the de-facto standard — vLLM serves it at `/rerank`, `/v1/rerank`, and
`/v2/rerank` specifically to be compatible with both, and OpenRouter, Jina, and
Cohere all answer it. The **TEI** shape (`{query, texts}` → a bare array of
`{index, score}`) is what Hugging Face's Text Embeddings Inference speaks.

A custom server is tried in that order and the working shape is remembered for
the process, because a rerank call happens once per query: re-probing shapes on
every retrieval would double the latency of the thing being reranked.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

import httpx

from app.clients.openai_compat.transport import OpenAICompatTransport
from app.schemas.chat_completions import RerankResponse, RerankResult

#: Path the Jina/Cohere shape is served at, relative to the `/v1` base.
RERANK_DEFAULT_PATH = "/rerank"


class RerankShape(StrEnum):
    """Request/response shape a rerank endpoint speaks."""

    JINA_COHERE = "jina_cohere"
    TEI = "tei"


def _post(
    transport: OpenAICompatTransport, path: str, payload: dict[str, Any]
) -> httpx.Response:
    """POST a rerank payload and raise on a non-2xx status."""
    response = transport.http.post(path, json=payload)
    response.raise_for_status()
    return response


def _jina_cohere(
    transport: OpenAICompatTransport, path: str, model: str, query: str, documents: list[str]
) -> RerankResponse:
    """Call the Jina/Cohere rerank shape."""
    payload = {
        "model": model,
        "query": query,
        "documents": documents,
        "top_n": len(documents),
    }
    return RerankResponse.model_validate(_post(transport, path, payload).json())


def _tei(
    transport: OpenAICompatTransport, path: str, model: str, query: str, documents: list[str]
) -> RerankResponse:
    """Call the TEI rerank shape and map its bare array onto the shared response."""
    payload = {"query": query, "texts": documents, "raw_scores": False}
    raw = _post(transport, path, payload).json()
    if not isinstance(raw, list):
        raise ValueError("TEI rerank endpoint did not return a result array.")
    results: list[RerankResult] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        index = entry.get("index")
        if index is None:
            continue
        score = entry.get("score")
        if score is None:
            score = entry.get("relevance_score", 0.0)
        results.append(RerankResult(index=int(index), relevance_score=float(score)))
    return RerankResponse(model=model, results=results)


def rerank(
    transport: OpenAICompatTransport,
    *,
    model: str,
    query: str,
    documents: list[str],
    path: str = RERANK_DEFAULT_PATH,
    shape: RerankShape = RerankShape.JINA_COHERE,
) -> RerankResponse:
    """Score every document against the query using the endpoint's shape."""
    if shape is RerankShape.TEI:
        return _tei(transport, path, model, query, documents)
    return _jina_cohere(transport, path, model, query, documents)
