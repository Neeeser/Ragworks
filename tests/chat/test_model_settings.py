"""Reasoning-default behavior in `prepare_model_settings`."""

from __future__ import annotations

from uuid import uuid4

from app.chat.model_settings import prepare_model_settings
from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.schemas.models import ModelInfo


class _Provider:
    name = "openai"

    def __init__(self, info: ModelInfo) -> None:
        self._info = info

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._info


def _settings(info: ModelInfo, *, reasoning_effort: str | None = None):
    return prepare_model_settings(
        provider=_Provider(info),  # type: ignore[arg-type]
        connection_label="OpenAI",
        payload=ChatMessageCreate(content="hi"),
        session_model=models.ChatSession(user_id=uuid4(), chat_model=info.id),
        reasoning_effort=reasoning_effort,
        tools_enabled=False,
    )


def _info(efforts: list[str] | None) -> ModelInfo:
    return ModelInfo(
        id="m",
        name="m",
        supported_parameters=["temperature", "reasoning", "tools"],
        reasoning_efforts=efforts,
    )


def test_model_whose_efforts_include_none_defaults_to_none() -> None:
    """OpenAI rejects `temperature` while reasoning is active, and `none` is
    these models' documented default — forcing medium breaks every sampling
    knob the panel legitimately shows."""
    settings = _settings(_info(["none", "low", "medium", "high", "xhigh"]))
    assert settings.reasoning_options["reasoning"]["effort"] == "none"


def test_model_without_a_none_level_keeps_the_medium_default() -> None:
    settings = _settings(_info(["low", "medium", "high"]))
    assert settings.reasoning_options["reasoning"]["effort"] == "medium"


def test_explicit_session_effort_beats_the_model_default() -> None:
    settings = _settings(
        _info(["none", "low", "medium", "high"]), reasoning_effort="high"
    )
    assert settings.reasoning_options["reasoning"]["effort"] == "high"


def test_non_reasoning_model_gets_no_reasoning_block_at_all() -> None:
    """A catalog that lists parameters but no reasoning marker positively says
    the model cannot reason; sending the block 400s on OpenAI."""
    info = ModelInfo(
        id="m", name="m", supported_parameters=["temperature", "tools"]
    )
    settings = _settings(info)
    assert settings.reasoning_options == {}
