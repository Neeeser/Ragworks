"""Consent-gated downloads of HuggingFace tokenizer JSON files."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

import httpx
from sqlmodel import Session
from tokenizers import Tokenizer

from app.db import models
from app.retrieval.tokenizers.huggingface import (
    cached_tokenizer_path,
    validate_hf_model_id,
)
from app.services.errors import ExternalServiceError, InvalidInputError

Download = Callable[[str], bytes]
_MAX_TOKENIZER_BYTES = 10 * 1024 * 1024


def _download_bytes(url: str) -> bytes:
    """Fetch one tokenizer JSON response from the fixed HuggingFace host."""
    try:
        with httpx.Client(follow_redirects=True, timeout=30.0) as client:
            response = client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ExternalServiceError(f"Could not download tokenizer.json: {exc}") from exc
    content = response.content
    if len(content) > _MAX_TOKENIZER_BYTES:
        raise InvalidInputError("Downloaded tokenizer.json exceeds the 10 MB limit.")
    return content


class HuggingFaceTokenizerService:
    """Resolve local tokenizer caches without ever downloading implicitly."""

    def __init__(
        self,
        session: Session,
        storage_path: Path,
        *,
        download: Download = _download_bytes,
    ) -> None:
        """Bind request persistence, bulk storage, and the download boundary."""
        self._session = session
        self._storage_path = storage_path
        self._download = download

    def ensure_available(
        self,
        user: models.User,
        model_id: str,
        *,
        explicit_consent: bool = False,
        remember: bool = False,
    ) -> Path:
        """Return a cached tokenizer, downloading only with recorded consent."""
        try:
            normalized = validate_hf_model_id(model_id)
        except ValueError as exc:
            raise InvalidInputError(str(exc)) from exc
        destination = cached_tokenizer_path(self._storage_path, normalized)
        if destination.is_file():
            return destination
        if not explicit_consent and not user.remember_hf_tokenizer_downloads:
            raise InvalidInputError(
                f"Download consent is required for HuggingFace tokenizer '{normalized}'."
            )

        url = f"https://huggingface.co/{normalized}/resolve/main/tokenizer.json"
        content = self._download(url)
        self._validate_tokenizer_json(content)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
        temporary.write_bytes(content)
        temporary.replace(destination)

        if explicit_consent and remember:
            user.remember_hf_tokenizer_downloads = True
            self._session.add(user)
            self._session.commit()
            self._session.refresh(user)
        return destination

    @staticmethod
    def _validate_tokenizer_json(content: bytes) -> None:
        """Reject non-JSON or incompatible files before they enter the cache."""
        try:
            Tokenizer.from_str(content.decode("utf-8"))
        # The Rust-backed `tokenizers` binding exposes parse failures as a
        # plain `Exception`, so this boundary must normalize that broad type.
        except Exception as exc:  # pylint: disable=broad-exception-caught
            raise InvalidInputError(
                "The downloaded file is not a valid tokenizer.json."
            ) from exc
