"""Token-counting interface and shared offset-based splitting."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

TokenOffset = tuple[int, int]


def whitespace_aligned_end(
    text: str,
    offsets: Sequence[TokenOffset],
    start_index: int,
    candidate_end: int,
    search_window: int = 16,
) -> int:
    """Back up a token cut to a nearby source-word boundary when possible."""
    lower_bound = max(start_index + 1, candidate_end - search_window + 1)
    for end_index in range(candidate_end, lower_bound - 1, -1):
        end = offsets[end_index - 1][1]
        if end >= len(text) or text[end].isspace():
            return end_index
    return candidate_end


def validate_token_window(chunk_size: int, overlap: int) -> None:
    """Validate the shared token-window constraints.

    Overlap is added to `chunk_size` rather than carved out of it, so it is
    not bounded by the size: a chunk spans ``chunk_size + overlap`` tokens and
    advances by `chunk_size`. Only a non-positive size or a negative overlap
    is incoherent — an overlap larger than the size repeats more than it
    advances, which is wasteful but well-defined, and the editor warns rather
    than refusing to run it.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if overlap < 0:
        raise ValueError("token overlap must be >= 0")


class TokenCounter(Protocol):
    """Count text tokens and split text at the same tokenizer's boundaries."""

    def count(self, text: str) -> int:
        """Return the number of model-facing tokens in ``text``."""
        ...

    def split(self, text: str, chunk_size: int, overlap: int = 0) -> list[str]:
        """Split text into token-bounded parts with a token overlap."""
        ...


def split_at_offsets(
    text: str,
    offsets: Sequence[TokenOffset],
    chunk_size: int,
    overlap: int = 0,
) -> list[str]:
    """Slice ``text`` into windows described by tokenizer character offsets.

    `chunk_size` is the document text each chunk advances by, and `overlap` is
    repeated on top of it, so a chunk spans ``chunk_size + overlap`` tokens —
    the number the embedder actually receives.
    """
    validate_token_window(chunk_size, overlap)
    if not offsets:
        return []

    window = chunk_size + overlap
    chunks: list[str] = []
    start_index = 0
    while start_index < len(offsets):
        candidate_end = min(start_index + window, len(offsets))
        end_index = whitespace_aligned_end(text, offsets, start_index, candidate_end)
        start = offsets[start_index][0]
        end = offsets[end_index - 1][1]
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end_index == len(offsets):
            break
        # Step back `overlap` tokens from the window's end so exactly that
        # many repeat — measuring from the end rather than striding a fixed
        # `chunk_size` keeps the overlap intact when whitespace alignment pulls
        # the end back short of a full window.
        next_start = max(start_index, end_index - overlap)
        if next_start == start_index:
            next_start = end_index
        start_index = next_start
    return chunks
