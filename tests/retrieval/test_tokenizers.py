from __future__ import annotations

import os
from pathlib import Path

import pytest
import tiktoken
from tokenizers import Tokenizer
from tokenizers.models import WordPiece
from tokenizers.normalizers import BertNormalizer
from tokenizers.pre_tokenizers import BertPreTokenizer

from app.pipelines.payloads import TokenizerSpec
from app.retrieval.tokenizers import (
    Cl100kTokenCounter,
    TokenizerJsonCounter,
    WhitespaceTokenCounter,
)
from app.retrieval.tokenizers.huggingface import cached_tokenizer_path
from app.retrieval.tokenizers.resources import build_token_counter


def _wordpiece_tokenizer(path: Path) -> Path:
    tokenizer = Tokenizer(
        WordPiece(
            vocab={"[UNK]": 0, "play": 1, "##ing": 2, "other": 3},
            unk_token="[UNK]",
        )
    )
    tokenizer.normalizer = BertNormalizer(lowercase=True)
    tokenizer.pre_tokenizer = BertPreTokenizer()
    tokenizer.save(str(path))
    return path


def _giant_wordpiece_tokenizer(path: Path) -> Path:
    tokenizer = Tokenizer(
        WordPiece(
            vocab={
                "[UNK]": 0,
                "before": 1,
                "after": 2,
                "long": 3,
                "##word": 4,
                "##piece": 5,
            },
            unk_token="[UNK]",
        )
    )
    tokenizer.normalizer = BertNormalizer(lowercase=True)
    tokenizer.pre_tokenizer = BertPreTokenizer()
    tokenizer.save(str(path))
    return path


def test_wordpiece_counter_catches_a_512_word_chunk_that_whitespace_misses(
    tmp_path: Path,
) -> None:
    text = " ".join(["playing"] * 512)
    wordpiece = TokenizerJsonCounter.from_file(
        _wordpiece_tokenizer(tmp_path / "tokenizer.json")
    )

    assert WhitespaceTokenCounter().count(text) == 512
    assert wordpiece.count(text) == 1024


def test_tokenizer_json_counter_splits_at_token_boundaries_with_overlap(
    tmp_path: Path,
) -> None:
    counter = TokenizerJsonCounter.from_file(
        _wordpiece_tokenizer(tmp_path / "tokenizer.json")
    )
    text = "playing other playing"

    chunks = counter.split(text, max_tokens=3, overlap=1)

    assert chunks == ["playing other", "other playing"]
    assert all(counter.count(chunk) <= 3 for chunk in chunks)


def test_wordpiece_split_prefers_whitespace_boundaries(tmp_path: Path) -> None:
    counter = TokenizerJsonCounter.from_file(
        _wordpiece_tokenizer(tmp_path / "tokenizer.json")
    )
    # The second WordPiece of ``playing`` straddles the naive two-token cut.
    # A nearby boundary is available after ``other`` and must be preferred.
    text = "other playing"

    chunks = counter.split(text, max_tokens=2)

    assert chunks == ["other", "playing"]
    assert all(counter.count(chunk) <= 2 for chunk in chunks)


def test_wordpiece_split_cuts_giant_word_when_no_boundary_exists(tmp_path: Path) -> None:
    counter = TokenizerJsonCounter.from_file(
        _giant_wordpiece_tokenizer(tmp_path / "tokenizer.json")
    )
    text = "before longwordpiece after"

    chunks = counter.split(text, max_tokens=2)

    assert chunks == ["before", "longword", "piece after"]
    assert "before" in chunks
    assert "after" in chunks[-1]
    assert all(counter.count(chunk) <= 2 for chunk in chunks)


def test_whitespace_counter_preserves_legacy_split_semantics() -> None:
    counter = WhitespaceTokenCounter()

    assert counter.count(" alpha\n beta  gamma ") == 3
    assert counter.split("alpha beta gamma delta", max_tokens=3, overlap=1) == [
        "alpha beta gamma",
        "gamma delta",
    ]


def test_offset_split_validates_window_arguments() -> None:
    counter = WhitespaceTokenCounter()

    with pytest.raises(ValueError, match="positive"):
        counter.split("hello", max_tokens=0)
    with pytest.raises(ValueError, match=">= 0"):
        counter.split("hello", max_tokens=2, overlap=-1)
    with pytest.raises(ValueError, match="smaller"):
        counter.split("hello", max_tokens=2, overlap=2)
    assert counter.split("", max_tokens=2) == []


def test_resource_factory_resolves_whitespace_and_cached_huggingface(
    tmp_path: Path,
) -> None:
    whitespace = build_token_counter(TokenizerSpec(kind="whitespace"), tmp_path)
    model_id = "owner/model"
    path = cached_tokenizer_path(tmp_path, model_id)
    path.parent.mkdir(parents=True)
    _wordpiece_tokenizer(path)
    huggingface = build_token_counter(
        TokenizerSpec(kind="huggingface", hf_model_id=model_id), tmp_path
    )

    assert whitespace.count("hello world") == 2
    assert huggingface.count("playing") == 2


def test_resource_factory_reuses_counters_and_reloads_changed_huggingface_file(
    tmp_path: Path,
) -> None:
    model_id = "owner/model"
    path = cached_tokenizer_path(tmp_path, model_id)
    path.parent.mkdir(parents=True)
    _wordpiece_tokenizer(path)
    spec = TokenizerSpec(kind="huggingface", hf_model_id=model_id)

    first = build_token_counter(spec, tmp_path)
    assert build_token_counter(spec, tmp_path) is first

    _wordpiece_tokenizer(path)
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert build_token_counter(spec, tmp_path) is not first


def test_resource_factory_reports_an_uncached_huggingface_tokenizer(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="Confirm the download"):
        build_token_counter(
            TokenizerSpec(kind="huggingface", hf_model_id="owner/model"), tmp_path
        )


def test_cl100k_split_keeps_multitoken_unicode_characters_within_budget() -> None:
    byte_encoding = tiktoken.Encoding(
        name="byte-test",
        pat_str=r"(?s).",
        mergeable_ranks={bytes([value]): value for value in range(256)},
        special_tokens={},
    )
    counter = Cl100kTokenCounter(byte_encoding)

    chunks = counter.split("😀" * 20, max_tokens=5)

    assert "".join(chunks) == "😀" * 20
    assert all(counter.count(chunk) <= 5 for chunk in chunks)


def test_bundled_wordpiece_tokenizer_loads_without_network(tmp_path: Path) -> None:
    counter = build_token_counter(TokenizerSpec(kind="wordpiece"), tmp_path)

    assert counter.count("hello world") == 2


def test_vendored_cl100k_tokenizer_loads_without_network(tmp_path: Path) -> None:
    counter = build_token_counter(TokenizerSpec(kind="cl100k"), tmp_path)

    assert counter.count("hello world") == 2


def test_cl100k_split_prefers_whitespace_boundaries(tmp_path: Path) -> None:
    counter = build_token_counter(TokenizerSpec(kind="cl100k"), tmp_path)
    text = "token-105 token-106 token-107 token-108"

    chunks = counter.split(text, max_tokens=4)

    assert all("token-" in chunk for chunk in chunks)
    assert all(counter.count(chunk) <= 4 for chunk in chunks)
