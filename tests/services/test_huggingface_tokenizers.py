from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from tokenizers import Tokenizer
from tokenizers.models import WordPiece

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.retrieval.tokenizers.huggingface import (
    cached_tokenizer_path,
    sanitize_hf_model_id,
)
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.huggingface_tokenizers import (
    HuggingFaceTokenizerService,
    _download_bytes,
)
from app.services.pipelines import PipelineService


def _tokenizer_json() -> bytes:
    tokenizer = Tokenizer(WordPiece(vocab={"[UNK]": 0, "hello": 1}, unk_token="[UNK]"))
    return tokenizer.to_str().encode("utf-8")


def _user(*, remembered: bool = False) -> models.User:
    return models.User(
        email="tokenizer@test.local",
        hashed_password="hashed",
        remember_hf_tokenizer_downloads=remembered,
    )


def test_huggingface_cache_key_is_safe_stable_and_collision_resistant(tmp_path: Path) -> None:
    key = sanitize_hf_model_id("sentence-transformers/all-MiniLM-L6-v2")

    assert "/" not in key
    assert key.startswith("sentence-transformers--all-MiniLM-L6-v2-")
    assert cached_tokenizer_path(tmp_path, "sentence-transformers/all-MiniLM-L6-v2") == (
        tmp_path / "tokenizers" / key / "tokenizer.json"
    )
    with pytest.raises(ValueError, match="model id"):
        sanitize_hf_model_id("../../etc/passwd")


def test_download_is_refused_without_explicit_or_remembered_consent(tmp_path: Path) -> None:
    service = HuggingFaceTokenizerService(
        MagicMock(),
        tmp_path,
        download=lambda _url: pytest.fail("download must not run"),
    )

    with pytest.raises(InvalidInputError, match="consent"):
        service.ensure_available(_user(), "owner/model")
    with pytest.raises(InvalidInputError, match="model id"):
        service.ensure_available(_user(), "../../unsafe")


def test_explicit_consent_downloads_only_tokenizer_json_and_remembers_preference(
    tmp_path: Path,
) -> None:
    urls: list[str] = []
    user = _user()
    session = MagicMock()
    service = HuggingFaceTokenizerService(
        session,
        tmp_path,
        download=lambda url: urls.append(url) or _tokenizer_json(),
    )

    path = service.ensure_available(
        user,
        "sentence-transformers/all-MiniLM-L6-v2",
        explicit_consent=True,
        remember=True,
    )

    assert urls == [
        "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json"
    ]
    assert path.read_bytes() == _tokenizer_json()
    assert user.remember_hf_tokenizer_downloads is True


def test_remembered_preference_allows_download_and_cached_file_skips_network(
    tmp_path: Path,
) -> None:
    calls = 0

    def download(_url: str) -> bytes:
        nonlocal calls
        calls += 1
        return _tokenizer_json()

    service = HuggingFaceTokenizerService(MagicMock(), tmp_path, download=download)
    user = _user(remembered=True)

    first = service.ensure_available(user, "owner/model")
    second = service.ensure_available(_user(), "owner/model")

    assert first == second
    assert calls == 1


def test_invalid_tokenizer_json_is_not_cached(tmp_path: Path) -> None:
    service = HuggingFaceTokenizerService(
        MagicMock(),
        tmp_path,
        download=lambda _url: b"not json",
    )

    with pytest.raises(InvalidInputError, match=r"valid tokenizer\.json"):
        service.ensure_available(_user(), "owner/model", explicit_consent=True)

    assert not cached_tokenizer_path(tmp_path, "owner/model").exists()


def test_pipeline_persistence_checks_each_huggingface_tokenizer(monkeypatch) -> None:
    checked: list[str] = []
    monkeypatch.setattr(
        HuggingFaceTokenizerService,
        "ensure_available",
        lambda _service, _user, model_id: checked.append(model_id),
    )
    service = PipelineService(MagicMock())
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="chunker",
                type="chunker.token",
                name="Token Chunker",
                config={"tokenizer": "huggingface", "hf_model_id": "owner/model"},
            )
        ]
    )

    service._ensure_huggingface_tokenizers(_user(remembered=True), definition)

    assert checked == ["owner/model"]


def test_http_download_boundary_normalizes_network_errors(monkeypatch) -> None:
    client = MagicMock()
    client.__enter__.return_value.get.side_effect = httpx.ConnectError("offline")
    monkeypatch.setattr(httpx, "Client", MagicMock(return_value=client))

    with pytest.raises(ExternalServiceError, match="Could not download"):
        _download_bytes("https://huggingface.co/owner/model/resolve/main/tokenizer.json")


def test_http_download_boundary_limits_response_size(monkeypatch) -> None:
    response = MagicMock(content=b"x" * (10 * 1024 * 1024 + 1))
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    monkeypatch.setattr(httpx, "Client", MagicMock(return_value=client))

    with pytest.raises(InvalidInputError, match="10 MB"):
        _download_bytes("https://huggingface.co/owner/model/resolve/main/tokenizer.json")


def test_http_download_boundary_returns_json_bytes(monkeypatch) -> None:
    response = MagicMock(content=b"{}")
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    monkeypatch.setattr(httpx, "Client", MagicMock(return_value=client))

    assert _download_bytes(
        "https://huggingface.co/owner/model/resolve/main/tokenizer.json"
    ) == b"{}"
