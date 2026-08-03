"""Template substitution and the final system-prompt rendering entrypoint."""

from __future__ import annotations

from pydantic import BaseModel

from app.db import models
from app.prompting import render_template

from .context import base_prompt_context


class PromptContext(BaseModel):
    """A tool template paired with its rendering context.

    Replaces the untyped `{"template": ..., "context": ...}` dicts
    `render_system_prompt` used to take -- one per tool collection enabled on
    a chat turn.
    """

    template: str
    context: dict[str, str]


def apply_prompt_template(template: str, context: dict[str, str]) -> str:
    """Apply context variables to a prompt template.

    Rendering is deliberately lenient: an unknown variable is left in
    place rather than failing the chat turn. Strictness lives at edit and
    save time, where the studio validates against the context's catalog.
    """
    return render_template(
        template,
        context,
        on_missing=lambda name: f"{{{{{name}}}}}",
    )


def render_system_prompt(
    tool_contexts: list[PromptContext],
    user: models.User | None,
    *,
    base_template: str,
) -> str:
    """Render the final system prompt for base and tool contexts.

    `base_template` is resolved by the caller (chat setup owns the session
    the reference resolution needs).
    """
    base_context = base_prompt_context(user)
    sections = [apply_prompt_template(base_template, base_context)]
    sections.extend(
        apply_prompt_template(tool_context.template, tool_context.context)
        for tool_context in tool_contexts
    )
    return "\n\n".join(section.strip() for section in sections if section.strip())
