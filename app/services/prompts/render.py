"""Template substitution and the final system-prompt rendering entrypoint."""

from __future__ import annotations

import re

from pydantic import BaseModel

from app.db import models

from .context import base_prompt_context
from .templates import get_base_prompt_template

_PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


class PromptContext(BaseModel):
    """A tool template paired with its rendering context.

    Replaces the untyped `{"template": ..., "context": ...}` dicts
    `render_system_prompt` used to take -- one per tool collection enabled on
    a chat turn.
    """

    template: str
    context: dict[str, str]


def apply_prompt_template(template: str, context: dict[str, str]) -> str:
    """Apply context variables to a prompt template."""

    def _replace(match: re.Match[str]) -> str:
        """Replace template placeholders with context values."""
        key = match.group(1)
        return context.get(key, match.group(0))

    return _PLACEHOLDER_PATTERN.sub(_replace, template)


def render_system_prompt(
    tool_contexts: list[PromptContext],
    user: models.User | None,
) -> str:
    """Render the final system prompt for base and tool contexts."""
    base_template = get_base_prompt_template(user)
    base_context = base_prompt_context(user)
    sections = [apply_prompt_template(base_template, base_context)]
    sections.extend(
        apply_prompt_template(tool_context.template, tool_context.context)
        for tool_context in tool_contexts
    )
    return "\n\n".join(section.strip() for section in sections if section.strip())
