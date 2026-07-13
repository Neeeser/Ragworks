"""Model-settings resolution for a chat turn.

Owns the provider-facing half of chat setup: resolving the session's provider
connection through the registry and turning the payload + model metadata into
`ModelSettings`. Split from `setup.py` so session/tool orchestration and
model/provider resolution each stay a single responsibility.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.chat.parameters import (
    build_reasoning_options,
    prepare_reasoning_override,
    sanitize_parameter_overrides,
)
from app.chat.state import ModelSettings
from app.db import models
from app.providers.chat.base import ChatProvider
from app.providers.registry import ProviderResolver
from app.schemas.chat import ChatMessageCreate
from app.schemas.enums import ProviderKind
from app.services.errors import InvalidInputError

# Context-window fallback when the provider's model catalog does not report
# one; matches the old `chat.settings` node's default.
DEFAULT_CONTEXT_WINDOW = 8192


def resolve_chat_provider(
    session: Session,
    *,
    user: models.User,
    session_model: models.ChatSession,
) -> tuple[ChatProvider, str]:
    """Resolve the session's chat provider through the connection registry.

    Raises a clear `InvalidInputError` when the session has no provider
    connection at all (fresh install, or the referenced connection was
    deleted and the payload supplied no replacement).
    """
    connection_id = session_model.provider_connection_id
    if connection_id is None:
        raise InvalidInputError("Pick a chat provider and model to start chatting.")
    resolver = ProviderResolver(user, session)
    adapter = resolver.adapter(connection_id, ProviderKind.CHAT)
    return adapter.chat_provider(), adapter.connection.label


def _build_reasoning_request_options(
    supported_parameters: list[str],
    reasoning_override: dict[str, Any] | None,
    default_effort: str | None,
) -> dict[str, Any]:
    """Build reasoning options for the current model."""
    override_effort = reasoning_override.get("effort") if reasoning_override else None
    options = build_reasoning_options(supported_parameters, override_effort or default_effort)
    if reasoning_override and "reasoning" in options:
        options["reasoning"].update(reasoning_override)
    return options


# Resolves model info, tool support, parameter overrides, reasoning options,
# provider preferences, and context window in one pass; splitting further
# would just relocate these locals into an intermediate object.
# pylint: disable-next=too-many-arguments
def prepare_model_settings(
    *,
    provider: ChatProvider,
    connection_label: str,
    payload: ChatMessageCreate,
    session_model: models.ChatSession,
    reasoning_effort: str | None,
    tools_enabled: bool,
) -> ModelSettings:
    """Resolve model settings, parameters, and preferences."""
    active_model_name = session_model.chat_model
    if not active_model_name:
        raise InvalidInputError("Pick a chat model to start chatting.")
    model_info = provider.get_model(active_model_name)
    if not model_info:
        raise InvalidInputError(f"Selected model is not available on {connection_label}.")
    supported_parameters = model_info.supported_parameters or []
    tool_supported = any(param.lower() == "tools" for param in supported_parameters)
    if tools_enabled and not tool_supported:
        raise InvalidInputError(
            "Selected model does not support tool calls required for retrieval."
        )
    parameter_overrides = sanitize_parameter_overrides(payload.parameters, supported_parameters)
    reasoning_override = prepare_reasoning_override(parameter_overrides.pop("reasoning", None))
    reasoning_options = _build_reasoning_request_options(
        supported_parameters, reasoning_override, reasoning_effort
    )
    provider_preferences = payload.provider.to_request_payload() if payload.provider else None
    context_window = model_info.context_length or DEFAULT_CONTEXT_WINDOW
    return ModelSettings(
        active_model_name=active_model_name,
        model_info=model_info,
        supported_parameters=supported_parameters,
        parameter_overrides=parameter_overrides,
        reasoning_options=reasoning_options,
        provider_preferences=provider_preferences,
        context_window=context_window,
    )
