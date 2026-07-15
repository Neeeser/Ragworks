"""Concrete token counters backed by bundled or cached tokenizer data."""

from __future__ import annotations

import re
from pathlib import Path

import tiktoken
from tiktoken.load import load_tiktoken_bpe
from tokenizers import Tokenizer

from .base import TokenOffset, split_at_offsets, validate_token_window

_NON_WHITESPACE = re.compile(r"\S+")
_CL100K_HASH = "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
_CL100K_PATTERN = (
    r"'(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}++|\p{N}{1,3}+|"
    r" ?[^\s\p{L}\p{N}]++[\r\n]*+|\s++$|\s*[\r\n]|\s+(?!\S)|\s"
)
_CL100K_SPECIAL_TOKENS = {
    "<|endoftext|>": 100257,
    "<|fim_prefix|>": 100258,
    "<|fim_middle|>": 100259,
    "<|fim_suffix|>": 100260,
    "<|endofprompt|>": 100276,
}


class WhitespaceTokenCounter:
    """Legacy counter where each non-whitespace run is one token."""

    @staticmethod
    def _offsets(text: str) -> list[TokenOffset]:
        return [(match.start(), match.end()) for match in _NON_WHITESPACE.finditer(text)]

    def count(self, text: str) -> int:
        """Count non-whitespace runs."""
        return len(self._offsets(text))

    def split(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
        """Split at whitespace-token boundaries."""
        return split_at_offsets(text, self._offsets(text), max_tokens, overlap)


class TokenizerJsonCounter:
    """Counter backed by a HuggingFace ``tokenizer.json`` file."""

    def __init__(self, tokenizer: Tokenizer) -> None:
        """Bind a loaded tokenizer."""
        self._tokenizer = tokenizer

    @classmethod
    def from_file(cls, path: Path) -> TokenizerJsonCounter:
        """Load a counter from a local tokenizer JSON file."""
        return cls(Tokenizer.from_file(str(path)))

    def _offsets(self, text: str) -> list[TokenOffset]:
        encoding = self._tokenizer.encode(text, add_special_tokens=False)
        return [(start, end) for start, end in encoding.offsets if end > start]

    def count(self, text: str) -> int:
        """Count tokens without adding model special tokens."""
        return len(self._tokenizer.encode(text, add_special_tokens=False).ids)

    def split(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
        """Split at the tokenizer's reported character offsets."""
        return split_at_offsets(text, self._offsets(text), max_tokens, overlap)


class Cl100kTokenCounter:
    """Counter backed by a vendored ``cl100k_base`` BPE ranks file."""

    def __init__(self, encoding: tiktoken.Encoding) -> None:
        """Bind a constructed tiktoken encoding."""
        self._encoding = encoding

    @classmethod
    def from_file(cls, path: Path) -> Cl100kTokenCounter:
        """Load cl100k ranks locally without tiktoken's network fetch."""
        mergeable_ranks = load_tiktoken_bpe(str(path), expected_hash=_CL100K_HASH)
        encoding = tiktoken.Encoding(
            name="cl100k_base_offline",
            pat_str=_CL100K_PATTERN,
            mergeable_ranks=mergeable_ranks,
            special_tokens=_CL100K_SPECIAL_TOKENS,
        )
        return cls(encoding)

    def _tokens(self, text: str) -> list[int]:
        return self._encoding.encode(text, disallowed_special=())

    def _weighted_offsets(self, text: str) -> list[tuple[int, int, int]]:
        """Group tokens that share one Unicode character boundary."""
        tokens = self._tokens(text)
        if not tokens:
            return []
        decoded, starts = self._encoding.decode_with_offsets(tokens)
        if decoded != text:
            raise ValueError("cl100k token offsets did not round-trip the input text")
        grouped: list[tuple[int, int]] = []
        for start in starts:
            if grouped and grouped[-1][0] == start:
                previous_start, count = grouped[-1]
                grouped[-1] = (previous_start, count + 1)
            else:
                grouped.append((start, 1))
        return [
            (
                start,
                grouped[index + 1][0] if index + 1 < len(grouped) else len(text),
                count,
            )
            for index, (start, count) in enumerate(grouped)
        ]

    def count(self, text: str) -> int:
        """Count cl100k tokens."""
        return len(self._tokens(text))

    def split(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
        """Split at cl100k token boundaries."""
        validate_token_window(max_tokens, overlap)
        spans = self._weighted_offsets(text)
        chunks: list[str] = []
        start_index = 0
        while start_index < len(spans):
            end_index = start_index
            token_count = 0
            while end_index < len(spans):
                weight = spans[end_index][2]
                if token_count and token_count + weight > max_tokens:
                    break
                token_count += weight
                end_index += 1
                if token_count >= max_tokens:
                    break
            chunks.append(text[spans[start_index][0] : spans[end_index - 1][1]].strip())
            if end_index == len(spans):
                break
            next_start = end_index
            overlap_count = 0
            while next_start > start_index:
                weight = spans[next_start - 1][2]
                if overlap_count + weight > overlap:
                    break
                overlap_count += weight
                next_start -= 1
            start_index = end_index if next_start == start_index else next_start
        return [chunk for chunk in chunks if chunk]
