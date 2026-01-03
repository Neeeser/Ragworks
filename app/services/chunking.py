"""Chunking strategies used by ingestion and retrieval services."""

from __future__ import annotations

import re
from typing import Sequence

from app.db.models import ChunkStrategy
from app.retrieval.chunkers.base import DocumentChunker
from app.retrieval.models import Document, DocumentChunk


class _BaseChunker(DocumentChunker):  # pylint: disable=too-few-public-methods
    """Shared helper for chunkers with size and overlap."""

    def __init__(self, chunk_size: int, overlap: int) -> None:
        """Initialize shared chunking parameters."""
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if overlap < 0:
            raise ValueError("chunk overlap must be >= 0")
        if overlap >= chunk_size:
            raise ValueError("chunk overlap must be smaller than chunk size")
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        """Chunk a document using the concrete implementation."""
        raise NotImplementedError

    def _build_chunk(self, document: Document, text: str, index: int) -> DocumentChunk:
        """Create a DocumentChunk for the current slice."""
        return DocumentChunk(
            document_id=document.document_id,
            chunk_id=f"{document.document_id}:{index}",
            text=text.strip(),
            order=index,
            metadata=document.metadata.model_copy(deep=True),
        )

    def _chunk_segments(
        self,
        document: Document,
        segments: Sequence[str],
    ) -> Sequence[DocumentChunk]:
        """Convert text segments into overlapping chunks."""
        normalized = [segment.strip() for segment in segments if segment and segment.strip()]
        if not normalized:
            fallback = (document.text or "").strip()
            normalized = [fallback] if fallback else []
        if not normalized:
            return []

        chunks: list[DocumentChunk] = []
        buffer: list[str] = []
        buffer_tokens = 0
        has_new_tokens = False

        def emit_chunk() -> None:
            """Flush the current buffer into a chunk."""
            nonlocal buffer, buffer_tokens, has_new_tokens
            chunk_text = " ".join(buffer)
            chunks.append(self._build_chunk(document, chunk_text, len(chunks)))
            if self.overlap > 0:
                buffer = buffer[-self.overlap :]
                buffer_tokens = len(buffer)
            else:
                buffer = []
                buffer_tokens = 0
            has_new_tokens = False

        for segment in normalized:
            tokens = segment.split()
            idx = 0
            while idx < len(tokens):
                remaining = self.chunk_size - buffer_tokens
                take = min(remaining, len(tokens) - idx)
                buffer.extend(tokens[idx : idx + take])
                buffer_tokens += take
                has_new_tokens = True
                idx += take
                if buffer_tokens == self.chunk_size:
                    emit_chunk()

        if buffer and has_new_tokens:
            emit_chunk()

        return chunks


class TokenChunker(_BaseChunker):  # pylint: disable=too-few-public-methods
    """Whitespace token chunker that supports overlap."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        """Chunk a document by whitespace tokens."""
        return self._chunk_segments(document, [document.text])


class SentenceChunker(_BaseChunker):  # pylint: disable=too-few-public-methods
    """Groups contiguous sentences up to the requested chunk size (in sentences)."""

    SENTENCE_REGEX = re.compile(r"(?<=[.!?])\s+")

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        """Chunk a document by sentence boundaries."""
        sentences = [s.strip() for s in self.SENTENCE_REGEX.split(document.text) if s.strip()]
        return self._chunk_segments(document, sentences)


class ParagraphChunker(_BaseChunker):  # pylint: disable=too-few-public-methods
    """Splits using blank lines as hard paragraph separators."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        """Chunk a document by paragraph boundaries."""
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", document.text) if p.strip()]
        return self._chunk_segments(document, paragraphs)


class SemanticChunker(_BaseChunker):  # pylint: disable=too-few-public-methods
    """Heuristic semantic chunker favoring headings and bullet boundaries."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        """Chunk a document using heading and list heuristics."""
        lines = [line.rstrip() for line in document.text.splitlines()]
        buffers: list[str] = []
        current: list[str] = []

        def flush() -> None:
            """Flush the current line buffer into a segment."""
            nonlocal current
            if current:
                text = "\n".join(current).strip()
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

        return self._chunk_segments(document, buffers)


def build_chunker(strategy: ChunkStrategy, chunk_size: int, overlap: int) -> DocumentChunker:
    """Factory for chunker implementations."""
    if strategy == ChunkStrategy.SENTENCE:
        return SentenceChunker(chunk_size=chunk_size, overlap=overlap)
    if strategy == ChunkStrategy.PARAGRAPH:
        return ParagraphChunker(chunk_size=chunk_size, overlap=overlap)
    if strategy == ChunkStrategy.SEMANTIC:
        return SemanticChunker(chunk_size=chunk_size, overlap=overlap)
    return TokenChunker(chunk_size=chunk_size, overlap=overlap)
