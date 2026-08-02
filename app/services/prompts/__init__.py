"""The prompt service package, split by responsibility.

- `templates.py` -- the shipped default template texts and the legacy
  metadata key.
- `library.py` -- the prompt library: entities, versions, forks,
  reference resolution (`PromptLibraryService`).
- `selection.py` -- which prompt a chat consumer uses: reference
  resolution and setters for the user base prompt and collection tool
  prompts.
- `seeding.py` -- shipped prompt specs and per-user seeding.
- `usage.py` -- the "used by" scan and the stored-reference conventions.
- `studio.py` -- render preview and the live test bench.
- `context.py` -- builds the `{{placeholder}} -> value` render context
  from domain models.
- `render.py` -- template substitution and `render_system_prompt`, the
  chat entrypoint composing base + tool sections.
"""

from __future__ import annotations

from .context import base_prompt_context, collection_tool_name, system_prompt_context
from .render import PromptContext, apply_prompt_template, render_system_prompt
from .templates import (
    DEFAULT_BASE_PROMPT_TEMPLATE,
    DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    SYSTEM_PROMPT_METADATA_KEY,
)

__all__ = [
    "DEFAULT_BASE_PROMPT_TEMPLATE",
    "DEFAULT_SYSTEM_PROMPT_TEMPLATE",
    "SYSTEM_PROMPT_METADATA_KEY",
    "PromptContext",
    "apply_prompt_template",
    "base_prompt_context",
    "collection_tool_name",
    "render_system_prompt",
    "system_prompt_context",
]
