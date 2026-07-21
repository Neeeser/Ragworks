"""Rebuild per-document corpus text from stored ingestion chunks.

Synthetic datasets stay portable BEIR triples: the corpus is plain text that
an eval run re-ingests through the ingestion pipeline under test. The source
collection's parsed representation lives in its stored chunks, so document
text is reconstructed by joining chunk texts in order and stripping the
chunker's overlap (consecutive token-window chunks repeat the tail of the
previous chunk verbatim).
"""

from __future__ import annotations

_MIN_OVERLAP_CHARS = 8
_GAP_JOINER = "\n\n"


def split_overlap(previous: str, current: str) -> tuple[str, bool]:
    """Return `current` without the prefix it repeats from `previous`.

    Token-window chunkers overlap by re-emitting the exact tail of the prior
    chunk, so the longest suffix-of-previous == prefix-of-current match is the
    overlap. The boolean reports whether an overlap was found; matches shorter
    than `_MIN_OVERLAP_CHARS` are ignored — a shared space or stopword is
    coincidence, not overlap.
    """
    limit = min(len(previous), len(current))
    for length in range(limit, _MIN_OVERLAP_CHARS - 1, -1):
        if previous.endswith(current[:length]):
            return current[length:], True
    return current, False


def join_chunks(chunk_texts: list[str]) -> str:
    """Reconstruct document text from ordered chunk texts.

    Where an overlap is found the continuation is seamless (chunkers slice
    mid-sentence, so inserting a separator would break words apart); where no
    overlap exists the pieces are joined with a paragraph break, since the gap
    shape is unknown. Chunks fully contained in their predecessor contribute
    nothing.
    """
    text = ""
    previous = ""
    for chunk in chunk_texts:
        if not previous:
            text = chunk
        else:
            piece, seamless = split_overlap(previous, chunk)
            if piece:
                text += piece if seamless else _GAP_JOINER + piece
        previous = chunk
    return text.strip()
