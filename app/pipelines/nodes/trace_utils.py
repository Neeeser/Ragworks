"""Helpers for building pipeline trace summaries."""

from __future__ import annotations

from typing import Optional, Sequence

from app.retrieval.models import DocumentChunk, ScoredChunk
from app.retrieval.parsers.base import DocumentSource


def preview_text(text: str, limit: int = 240) -> str:
    """Return a truncated preview of text."""
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def summarize_source(source: DocumentSource) -> dict[str, object]:
    """Summarize a document source payload."""
    return {
        "document_id": source.document_id,
        "path": str(source.path),
        "content_type": source.content_type,
    }


def summarize_text(
    text: str,
    limit: int = 240,
    full_limit: int = 2000,
) -> dict[str, object]:
    """Summarize text content with a preview and optional full text."""
    summary: dict[str, object] = {
        "preview": preview_text(text, limit),
        "length": len(text),
    }
    if len(text) <= full_limit:
        summary["full"] = text
    return summary


def summarize_chunks(
    chunks: Sequence[DocumentChunk],
    limit: int = 3,
) -> dict[str, object]:
    """Summarize a batch of document chunks."""
    samples: list[dict[str, object]] = []
    for chunk in chunks[:limit]:
        samples.append(
            {
                "chunk_id": chunk.chunk_id,
                "order": chunk.order,
                "preview": preview_text(chunk.text, 160),
            }
        )
    summary: dict[str, object] = {"count": len(chunks), "samples": samples}
    if chunks:
        summary["document_id"] = chunks[0].document_id
    return summary


def _embedding_preview(
    embedding: Optional[Sequence[float]],
    limit: int = 12,
) -> Optional[dict[str, object]]:
    """Return a preview for an embedding vector."""
    if embedding is None:
        return None
    return {
        "preview": list(embedding[:limit]),
        "total_values": len(embedding),
    }


def summarize_embeddings(
    chunks: Sequence[DocumentChunk],
    limit: int = 2,
) -> dict[str, object]:
    """Summarize embeddings attached to chunks."""
    dimension: Optional[int] = None
    samples: list[dict[str, object]] = []
    for chunk in chunks[:limit]:
        embedding_preview = _embedding_preview(chunk.embedding)
        if dimension is None and chunk.embedding is not None:
            dimension = len(chunk.embedding)
        samples.append(
            {
                "chunk_id": chunk.chunk_id,
                "preview": embedding_preview,
            }
        )
    return {
        "count": len(chunks),
        "dimension": dimension,
        "samples": samples,
    }


def summarize_query_embedding(
    embedding: Optional[Sequence[float]],
) -> dict[str, object]:
    """Summarize a query embedding vector."""
    return _embedding_preview(embedding) or {"preview": [], "total_values": 0}


def summarize_matches(
    matches: Sequence[ScoredChunk],
    limit: int = 5,
) -> dict[str, object]:
    """Summarize retrieval matches with scores and previews."""
    top_matches: list[dict[str, object]] = []
    for index, match in enumerate(matches[:limit], start=1):
        top_matches.append(
            {
                "rank": index,
                "chunk_id": match.chunk.chunk_id,
                "document_id": match.chunk.document_id,
                "score": match.score,
                "preview": preview_text(match.chunk.text, 160),
            }
        )
    return {"count": len(matches), "top_matches": top_matches}


def summarize_match_order(
    matches: Sequence[ScoredChunk],
    limit: int = 8,
) -> list[dict[str, object]]:
    """Summarize match order for reranking comparisons."""
    ordered: list[dict[str, object]] = []
    for index, match in enumerate(matches[:limit], start=1):
        ordered.append(
            {
                "rank": index,
                "chunk_id": match.chunk.chunk_id,
                "score": match.score,
            }
        )
    return ordered
