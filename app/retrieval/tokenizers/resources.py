"""Construct counters from bundled or cached tokenizer data."""

from __future__ import annotations

from importlib.resources import files
from pathlib import Path

from app.pipelines.payloads import TokenizerSpec

from .base import TokenCounter
from .counters import Cl100kTokenCounter, TokenizerJsonCounter, WhitespaceTokenCounter
from .huggingface import cached_tokenizer_path

_DATA_PACKAGE = "app.retrieval.tokenizers.data"


def _bundled_path(filename: str) -> Path:
    return Path(str(files(_DATA_PACKAGE).joinpath(filename)))


def build_token_counter(spec: TokenizerSpec, storage_path: Path) -> TokenCounter:
    """Construct the counter selected by a tokenizer resource payload."""
    if spec.kind == "whitespace":
        return WhitespaceTokenCounter()
    if spec.kind == "cl100k":
        return Cl100kTokenCounter.from_file(_bundled_path("cl100k_base.tiktoken"))
    if spec.kind == "huggingface":
        if spec.hf_model_id is None:  # model validation makes this defensive only
            raise ValueError("A HuggingFace tokenizer requires a model id.")
        path = cached_tokenizer_path(storage_path, spec.hf_model_id)
        if not path.is_file():
            raise FileNotFoundError(
                f"Tokenizer for '{spec.hf_model_id}' is not downloaded. Confirm the download "
                "in the pipeline editor and retry."
            )
        return TokenizerJsonCounter.from_file(path)
    return TokenizerJsonCounter.from_file(
        _bundled_path("bert-base-uncased-tokenizer.json")
    )
