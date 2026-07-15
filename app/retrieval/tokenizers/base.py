"""Token-counting interface and shared offset-based splitting."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

TokenOffset = tuple[int, int]


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
    step = max_tokens - overlap
    for start_index in range(0, len(offsets), step):
        end_index = min(start_index + max_tokens, len(offsets))
        start = offsets[start_index][0]
        end = offsets[end_index - 1][1]
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end_index == len(offsets):
            break
    return chunks
