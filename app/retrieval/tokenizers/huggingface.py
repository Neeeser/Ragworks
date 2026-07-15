"""Safe HuggingFace model identifiers and tokenizer cache paths."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

_MODEL_ID = re.compile(
    r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,95})"
    r"(?:/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,95}))?"
)


def validate_hf_model_id(model_id: str) -> str:
    """Return a normalized repository id or reject unsafe/path-like input."""
    normalized = model_id.strip()
    if not normalized or not _MODEL_ID.fullmatch(normalized):
        raise ValueError("HuggingFace model id must be 'name' or 'owner/name'.")
    if any(part in {".", ".."} for part in normalized.split("/")):
        raise ValueError("HuggingFace model id contains an unsafe path segment.")
    return normalized


def sanitize_hf_model_id(model_id: str) -> str:
    """Build a collision-resistant single-directory cache key."""
    normalized = validate_hf_model_id(model_id)
    readable = normalized.replace("/", "--")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"{readable}-{digest}"


def cached_tokenizer_path(storage_path: Path, model_id: str) -> Path:
    """Return the cache file for a validated HuggingFace repository id."""
    return storage_path / "tokenizers" / sanitize_hf_model_id(model_id) / "tokenizer.json"
