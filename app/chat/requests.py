"""Turning a turn's typed message history into one provider request.

The wire boundary for a chat turn: messages are typed `ProviderMessage`s
everywhere inside the subsystem and become request dicts exactly here,
after the model-capability strip decides whether image parts may travel.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.chat.attachments import strip_unreadable_image_parts
from app.chat.persistence import serialize_messages
from app.providers.chat.base import ChatRequest

if TYPE_CHECKING:
    # Deferred: run_loop imports this module, so a real import is circular.
    from app.chat.run_loop import ChatRun


def build_request(run: ChatRun) -> ChatRequest:
    """Build the provider request for the current message history (shared by both modes)."""
    parameters, extra_body = run.setup.model.request_parameters()
    messages = strip_unreadable_image_parts(
        serialize_messages(run.setup.messages),
        user=run.user,
        session=run.session,
        session_model=run.setup.session_model,
    )
    return ChatRequest(
        messages=messages,
        tools=run.setup.tools or None,
        model=run.setup.model.active_model_name,
        parameters=parameters,
        reasoning_options=run.setup.model.reasoning_options or None,
        provider_preferences=run.setup.model.provider_preferences,
        extra_body=extra_body,
    )
