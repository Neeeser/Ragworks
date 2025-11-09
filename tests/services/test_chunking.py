from __future__ import annotations

from app.db.models import ChunkStrategy
from app.retrieval.models import Document, DocumentMetadata
from app.services.chunking import build_chunker


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
