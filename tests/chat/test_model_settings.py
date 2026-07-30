"""Reasoning-default behavior in `prepare_model_settings`."""

from __future__ import annotations

from uuid import uuid4

from app.chat.model_settings import prepare_model_settings
from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.schemas.models import ChatCapabilities, ModelInfo, ReasoningStyle


class _Provider:
    name = "openai"

    def __init__(self, info: ModelInfo) -> None:
        self._info = info

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._info


def _settings(
    info: ModelInfo,
    *,
    reasoning_effort: str | None = None,
    payload: ChatMessageCreate | None = None,
):
    return prepare_model_settings(
        provider=_Provider(info),  # type: ignore[arg-type]
        connection_label="OpenAI",
        payload=payload or ChatMessageCreate(content="hi"),
        session_model=models.ChatSession(user_id=uuid4(), chat_model=info.id),
        reasoning_effort=reasoning_effort,
        tools_enabled=False,
    )


def _info(efforts: list[str]) -> ModelInfo:
    return ModelInfo(
        id="m",
        name="m",
        supported_parameters=["temperature"],
        capabilities=ChatCapabilities(
            tools=True,
            reasoning=ReasoningStyle.BLOCK,
            reasoning_efforts=efforts,
        ),
    )


def test_model_whose_efforts_include_none_defaults_to_none() -> None:
    """OpenAI rejects `temperature` while reasoning is active, and `none` is
    these models' documented default — forcing medium breaks every sampling
    knob the panel legitimately shows."""
    settings = _settings(_info(["none", "low", "medium", "high", "xhigh"]))
    assert settings.reasoning_options["reasoning"]["effort"] == "none"


def test_model_without_a_none_level_names_no_effort_at_all() -> None:
    """Saying nothing leaves the model on its own default; inventing `medium`
    would override a choice the user never made."""
    settings = _settings(_info(["low", "medium", "high"]))
    assert settings.reasoning_options == {"reasoning": {}}


def test_explicit_session_effort_beats_the_model_default() -> None:
    settings = _settings(
        _info(["none", "low", "medium", "high"]), reasoning_effort="high"
    )
    assert settings.reasoning_options["reasoning"]["effort"] == "high"


def test_non_reasoning_model_gets_no_reasoning_block_at_all() -> None:
    """A model whose provider never claimed reasoning must not be sent a
    block: it is a hard 400 naming a field the user never set."""
    info = ModelInfo(
        id="m",
        name="m",
        supported_parameters=["temperature"],
        capabilities=ChatCapabilities(tools=True),
    )
    settings = _settings(info)
    assert settings.reasoning_options == {}


def test_a_model_with_no_published_efforts_still_reasons_when_asked() -> None:
    """Anthropic's budget-thinking models publish no effort levels; the
    reasoning claim alone must still reach the provider."""
    info = ModelInfo(
        id="m",
        name="m",
        supported_parameters=["temperature"],
        capabilities=ChatCapabilities(tools=True, reasoning=ReasoningStyle.BLOCK),
    )
    settings = _settings(info, reasoning_effort=None)
    assert settings.reasoning_options == {"reasoning": {}}


def test_a_requested_effort_survives_the_knob_filter() -> None:
    """Reasoning is a capability, so it is absent from `supported_parameters`.
    Reading the request through that filter dropped the user's chosen effort
    silently — the turn ran at the model's default and the panel still showed
    the choice."""
    settings = _settings(
        _info(["none", "low", "medium", "high"]),
        payload=ChatMessageCreate(
            content="hi", parameters={"reasoning": {"effort": "high"}}
        ),
    )
    assert settings.reasoning_options == {"reasoning": {"effort": "high"}}
