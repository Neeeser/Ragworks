"""The `{{variable}}` template grammar: parse, validate, render.

Placeholders are double-brace dotted names (`{{user.email}}`,
`{{metadata.author}}`). Anything that is not a well-formed placeholder —
including single braces and the brace runs JSON produces — is literal
text, so prompts containing JSON examples need no escaping. Names are
strict: rendering a variable the caller did not supply raises, so a typo
fails validation instead of silently shipping `{{chunk_txt}}` to the
model.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]*)\s*\}\}")


class PromptTemplateError(ValueError):
    """A template references an unknown or unavailable variable."""


def referenced_variables(template: str) -> set[str]:
    """Return every variable name a template references."""
    return {match.group(1) for match in _PLACEHOLDER.finditer(template)}


def render_template(
    template: str,
    values: Mapping[str, str],
    *,
    on_missing: Callable[[str], str] | None = None,
) -> str:
    """Substitute values into a template.

    A referenced variable absent from `values` raises unless `on_missing`
    supplies a replacement — callers with richer context (the LLM engine's
    "no document is wired in" reasons) pass one that raises their own
    message or returns a fallback.
    """

    def _substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        value = values.get(name)
        if value is not None:
            return value
        if on_missing is not None:
            return on_missing(name)
        raise PromptTemplateError(f"Unknown variable '{{{{{name}}}}}'.")

    return _PLACEHOLDER.sub(_substitute, template)
