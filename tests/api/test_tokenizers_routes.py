from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api.routes.pipelines import validate_pipeline
from app.api.routes.tokenizers import ensure_huggingface_tokenizer
from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.schemas.tokenizers import HuggingFaceTokenizerDownload
from app.services.errors import InvalidInputError


def _user() -> models.User:
    return models.User(email="tokenizer@test.local", hashed_password="hashed")


def test_tokenizer_route_forwards_explicit_and_remembered_consent(monkeypatch) -> None:
    calls: list[tuple[str, bool, bool]] = []

    def ensure(
        _service,
        _user,
        model_id: str,
        *,
        explicit_consent: bool = False,
        remember: bool = False,
    ) -> Path:
        calls.append((model_id, explicit_consent, remember))
        return Path("tokenizer.json")

    monkeypatch.setattr(
        "app.api.routes.tokenizers.HuggingFaceTokenizerService.ensure_available",
        ensure,
    )

    result = ensure_huggingface_tokenizer(
        HuggingFaceTokenizerDownload(
            model_id="owner/model",
            consent=True,
            remember=True,
        ),
        current_user=_user(),
        session=MagicMock(),
    )

    assert result.model_id == "owner/model"
    assert result.cached is True
    assert calls == [("owner/model", True, True)]


def test_tokenizer_route_maps_consent_refusal_to_bad_request(monkeypatch) -> None:
    def refuse(*_args, **_kwargs):
        raise InvalidInputError("Download consent is required.")

    monkeypatch.setattr(
        "app.api.routes.tokenizers.HuggingFaceTokenizerService.ensure_available",
        refuse,
    )

    with pytest.raises(HTTPException) as caught:
        ensure_huggingface_tokenizer(
            HuggingFaceTokenizerDownload(model_id="owner/model"),
            current_user=_user(),
            session=MagicMock(),
        )

    assert caught.value.status_code == 400
    assert caught.value.detail == "Download consent is required."


def test_pipeline_validation_route_returns_an_unsafe_model_id_issue() -> None:
    result = validate_pipeline(
        PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="tokenizer",
                    type="tokenizer.huggingface",
                    name="HuggingFace tokenizer",
                    config={"hf_model_id": "../../unsafe"},
                )
            ]
        ),
        current_user=_user(),
        session=MagicMock(),
    )

    assert result.valid is False
    assert result.issues[0].field == "hf_model_id"
