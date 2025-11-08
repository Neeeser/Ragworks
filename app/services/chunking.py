from __future__ import annotations

import re
from typing import Sequence

from app.db.models import ChunkStrategy
from app.retrieval.chunkers.base import DocumentChunker
from app.retrieval.models import Document, DocumentChunk


class _BaseChunker(DocumentChunker):
    def __init__(self, chunk_size: int, overlap: int) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if overlap < 0:
            raise ValueError("chunk overlap must be >= 0")
        if overlap >= chunk_size:
            raise ValueError("chunk overlap must be smaller than chunk size")
        self.chunk_size = chunk_size
        self.overlap = overlap

    def _build_chunk(self, document: Document, text: str, index: int) -> DocumentChunk:
        return DocumentChunk(
            document_id=document.document_id,
            chunk_id=f"{document.document_id}:{index}",
            text=text.strip(),
            order=index,
            metadata=document.metadata.model_copy(deep=True),
        )


class TokenChunker(_BaseChunker):
    """Whitespace token chunker that supports overlap."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        tokens = document.text.split()
        if not tokens:
            return []
        step = self.chunk_size - self.overlap
        chunks: list[DocumentChunk] = []
        for idx in range(0, len(tokens), step):
            window = tokens[idx : idx + self.chunk_size]
            if not window:
                continue
            chunks.append(self._build_chunk(document, " ".join(window), len(chunks)))
        return chunks


class SentenceChunker(_BaseChunker):
    """Groups contiguous sentences up to the requested chunk size (in sentences)."""

    SENTENCE_REGEX = re.compile(r"(?<=[.!?])\s+")

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        sentences = [s.strip() for s in self.SENTENCE_REGEX.split(document.text) if s.strip()]
        if not sentences:
            return []
        chunks: list[DocumentChunk] = []
        step = self.chunk_size - self.overlap
        for idx in range(0, len(sentences), step):
            window = sentences[idx : idx + self.chunk_size]
            if not window:
                continue
            text = " ".join(window)
            chunks.append(self._build_chunk(document, text, len(chunks)))
        return chunks


class ParagraphChunker(_BaseChunker):
    """Splits using blank lines as hard paragraph separators."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", document.text) if p.strip()]
        if not paragraphs:
            return []
        chunks: list[DocumentChunk] = []
        step = self.chunk_size - self.overlap
        for idx in range(0, len(paragraphs), step):
            window = paragraphs[idx : idx + self.chunk_size]
            if not window:
                continue
            text = "\n\n".join(window)
            chunks.append(self._build_chunk(document, text, len(chunks)))
        return chunks


class SemanticChunker(_BaseChunker):
    """Heuristic semantic chunker favoring headings and bullet boundaries."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        lines = [line.rstrip() for line in document.text.splitlines()]
        buffers: list[str] = []
        chunks: list[DocumentChunk] = []
        current: list[str] = []
        count = 0

        def flush() -> None:
            nonlocal count, current
            if current:
                text = "\n".join(current).strip()
                if text:
                    buffers.append(text)
                current = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                flush()
                continue
            if stripped.startswith(("#", "-", "*", "##")) or stripped.isupper():
                flush()
            current.append(stripped)
            if len(" ".join(current).split()) >= self.chunk_size:
                flush()
        flush()

        step = max(1, self.chunk_size - self.overlap)
        for idx in range(0, len(buffers), step):
            window = buffers[idx : idx + self.chunk_size]
            if not window:
                continue
            text = "\n\n".join(window)
            chunks.append(self._build_chunk(document, text, len(chunks)))
        return chunks


def build_chunker(strategy: ChunkStrategy, chunk_size: int, overlap: int) -> DocumentChunker:
    if strategy == ChunkStrategy.SENTENCE:
        return SentenceChunker(chunk_size=chunk_size, overlap=overlap)
    if strategy == ChunkStrategy.PARAGRAPH:
        return ParagraphChunker(chunk_size=chunk_size, overlap=overlap)
    if strategy == ChunkStrategy.SEMANTIC:
        return SemanticChunker(chunk_size=chunk_size, overlap=overlap)
    return TokenChunker(chunk_size=chunk_size, overlap=overlap)

