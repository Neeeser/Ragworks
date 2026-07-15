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


def validate_token_window(max_tokens: int, overlap: int) -> None:
    """Validate the shared token-window constraints."""
    if max_tokens <= 0:
        raise ValueError("max_tokens must be positive")
    if overlap < 0:
        raise ValueError("token overlap must be >= 0")
    if overlap >= max_tokens:
        raise ValueError("token overlap must be smaller than max_tokens")


class TokenCounter(Protocol):
    """Count text tokens and split text at the same tokenizer's boundaries."""

    def count(self, text: str) -> int:
        """Return the number of model-facing tokens in ``text``."""
        ...

    def split(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
        """Split text into token-bounded parts with a token overlap."""
        ...


def split_at_offsets(
    text: str,
    offsets: Sequence[TokenOffset],
    max_tokens: int,
    overlap: int = 0,
) -> list[str]:
    """Slice ``text`` into windows described by tokenizer character offsets."""
    validate_token_window(max_tokens, overlap)
    if not offsets:
        return []

    chunks: list[str] = []
    start_index = 0
    while start_index < len(offsets):
        candidate_end = min(start_index + max_tokens, len(offsets))
        end_index = whitespace_aligned_end(text, offsets, start_index, candidate_end)
        start = offsets[start_index][0]
        end = offsets[end_index - 1][1]
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end_index == len(offsets):
            break
        next_start = max(start_index, end_index - overlap)
        if next_start == start_index:
            next_start = end_index
        start_index = next_start
    return chunks
