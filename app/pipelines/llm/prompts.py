"""Placeholder template rendering for LLM node prompts.

Prompts are prose with `{placeholder}` substitution — deliberately not the
expression grammar. The placeholder set is small and closed: `{text}`,
`{query}`, `{document_text}`, `{items}`, and `{metadata.<key>}`. `{{`/`}}`
escape literal braces. Unknown placeholders are rejected so a typo fails
validation instead of silently shipping `{chunk_txt}` to the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_PLACEHOLDER = re.compile(r"\{\{|\}\}|\{([^{}]*)\}")

#: Placeholders that do not read a metadata key.
BASE_PLACEHOLDERS = frozenset({"text", "query", "document_text", "items"})

_METADATA_PREFIX = "metadata."


class PromptTemplateError(ValueError):
    """A template references an unknown or unavailable placeholder."""


@dataclass
class PromptContext:
    """Values available to one prompt rendering.

    A `None` value means the placeholder is unavailable in this rendering
    (no document wired, no query on an ingestion run) — referencing it is an
    error, so prompts never silently render an empty section.
    """

    text: str | None = None
    query: str | None = None
    document_text: str | None = None
    items_block: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


def referenced_placeholders(template: str) -> set[str]:
    """Return every placeholder name a template references.

    Metadata references are returned whole (`metadata.author`); malformed
    placeholders (empty braces, spaces) raise so validation can report them.
    """
    names: set[str] = set()
    for match in _PLACEHOLDER.finditer(template):
        if match.group(0) in ("{{", "}}"):
            continue
        name = match.group(1)
        if not _is_valid_placeholder(name):
            raise PromptTemplateError(
                f"Unknown placeholder '{{{name}}}'. Available: "
                "{text}, {query}, {document_text}, {items}, {metadata.<key>}."
            )
        names.add(name)
    return names


def _is_valid_placeholder(name: str) -> bool:
    if name in BASE_PLACEHOLDERS:
        return True
    if name.startswith(_METADATA_PREFIX):
        key = name[len(_METADATA_PREFIX) :]
        return bool(key) and "." not in key and " " not in key
    return False


def render(template: str, context: PromptContext) -> str:
    """Render a template against the values available to this call."""

    def _substitute(match: re.Match[str]) -> str:
        token = match.group(0)
        if token == "{{":
            return "{"
        if token == "}}":
            return "}"
        name = match.group(1)
        if not _is_valid_placeholder(name):
            raise PromptTemplateError(
                f"Unknown placeholder '{{{name}}}'. Available: "
                "{text}, {query}, {document_text}, {items}, {metadata.<key>}."
            )
        if name.startswith(_METADATA_PREFIX):
            key = name[len(_METADATA_PREFIX) :]
            value = context.metadata.get(key)
            return "" if value is None else str(value)
        available = {
            "text": context.text,
            "query": context.query,
            "document_text": context.document_text,
            "items": context.items_block,
        }[name]
        if available is None:
            raise PromptTemplateError(
                f"Placeholder '{{{name}}}' is not available here — " + _unavailable_reason(name)
            )
        return available

    return _PLACEHOLDER.sub(_substitute, template)


def _unavailable_reason(name: str) -> str:
    reasons = {
        "text": "this node's input items carry no text.",
        "query": "this run has no query (ingestion runs don't).",
        "document_text": "no document is wired into the node's document input.",
        "items": "only listwise prompts can render the numbered item list.",
    }
    return reasons[name]


def render_items_block(texts: list[str]) -> str:
    """Render the numbered item list a listwise prompt embeds via `{items}`."""
    return "\n\n".join(f"[{index + 1}] {text}" for index, text in enumerate(texts))
