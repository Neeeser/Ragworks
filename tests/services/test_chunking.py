from __future__ import annotations

import pytest

from app.db.models import ChunkStrategy
from app.retrieval.models import Document, DocumentMetadata
from app.services.chunking import _BaseChunker, build_chunker


def _document(text: str) -> Document:
    return Document(
        document_id="doc-1",
        text=text,
        metadata=DocumentMetadata(),
    )


def _chunk_lengths(chunks) -> list[int]:
    return [len(chunk.text.split()) for chunk in chunks]


def test_paragraph_chunker_falls_back_to_token_chunks_when_no_blank_lines() -> None:
    text = " ".join(f"token{i}" for i in range(300))
    chunker = build_chunker(ChunkStrategy.PARAGRAPH, 50, 10)

    chunks = chunker.chunk(_document(text))

    assert len(chunks) >= 5
    assert all(length <= 50 for length in _chunk_lengths(chunks))


def test_paragraph_chunker_trims_long_paragraphs_that_exceed_chunk_size() -> None:
    long_paragraph = " ".join(f"word{i}" for i in range(120))
    short_paragraph = "short ending paragraph " * 3
    text = f"{long_paragraph}\n\n{short_paragraph}"
    chunker = build_chunker(ChunkStrategy.PARAGRAPH, 64, 16)

    chunks = chunker.chunk(_document(text))

    assert len(chunks) >= 2
    lengths = _chunk_lengths(chunks)
    assert all(length <= 64 for length in lengths)
    # ensure the long paragraph was split rather than dropped
    assert lengths[0] == 64


def test_sentence_chunker_respects_chunk_size_even_for_single_sentence() -> None:
    long_sentence = " ".join(f"token{i}" for i in range(80)) + "."
    text = f"{long_sentence} Another short sentence."
    chunker = build_chunker(ChunkStrategy.SENTENCE, 32, 8)

    chunks = chunker.chunk(_document(text))

    assert len(chunks) >= 2
    assert all(length <= 32 for length in _chunk_lengths(chunks))


def test_token_chunker_rejects_invalid_configuration() -> None:
    with pytest.raises(ValueError, match="chunk_size must be positive"):
        build_chunker(ChunkStrategy.TOKEN, 0, 0)

    with pytest.raises(ValueError, match="chunk overlap must be >= 0"):
        build_chunker(ChunkStrategy.TOKEN, 10, -1)

    with pytest.raises(ValueError, match="chunk overlap must be smaller"):
        build_chunker(ChunkStrategy.TOKEN, 5, 5)


def test_token_chunker_returns_empty_for_blank_document() -> None:
    chunker = build_chunker(ChunkStrategy.TOKEN, 10, 0)

    chunks = chunker.chunk(_document("   \n\t"))

    assert chunks == []


def test_token_chunker_emits_overlap_chunks() -> None:
    text = " ".join(f"token{i}" for i in range(10))
    chunker = build_chunker(ChunkStrategy.TOKEN, 4, 1)

    chunks = chunker.chunk(_document(text))

    assert len(chunks) >= 3
    assert chunks[0].text.split() == ["token0", "token1", "token2", "token3"]
    assert chunks[1].text.split()[0] == "token3"


def test_semantic_chunker_flushes_on_headings() -> None:
    text = "\n".join(
        [
            "# Heading",
            "Line one",
            "Line two",
            "",
            "SECTION TITLE",
            "Bullet point one",
            "- Bullet point two",
        ]
    )
    chunker = build_chunker(ChunkStrategy.SEMANTIC, 5, 0)

    chunks = chunker.chunk(_document(text))

    assert len(chunks) >= 2


def test_semantic_chunker_emits_buffered_segment() -> None:
    text = "\n".join(["# Heading", "Line one", "", "Line two"])
    chunker = build_chunker(ChunkStrategy.SEMANTIC, 10, 0)

    chunks = chunker.chunk(_document(text))

    assert any("Heading" in chunk.text for chunk in chunks)


def test_base_chunker_chunk_not_implemented() -> None:
    chunker = _BaseChunker(chunk_size=2, overlap=0)

    with pytest.raises(NotImplementedError):
        chunker.chunk(_document("hello world"))


def test_chunk_segments_falls_back_to_document_text() -> None:
    class _DirectChunker(_BaseChunker):
        def __init__(self, segments: list[str]) -> None:
            super().__init__(chunk_size=2, overlap=0)
            self._segments = segments

        def chunk(self, document: Document):
            return self._chunk_segments(document, self._segments)

    chunker = _DirectChunker(["", "   "])
    chunks = chunker.chunk(_document("alpha beta gamma"))

    assert [chunk.text for chunk in chunks] == ["alpha beta", "gamma"]
