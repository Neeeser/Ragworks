"""LLM node prompt rendering over the unified `{{variable}}` engine.

The grammar and strictness live in `app/prompting`; this module supplies
what only the node runtime knows — which values one call actually has,
and why a referenced variable is unavailable (no query on an ingestion
run, no document wired in). Metadata references (`{{metadata.author}}`)
read the item's metadata and render empty when the key is absent, because
key presence is corpus data, not configuration.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.prompting import PromptTemplateError, referenced_variables, render_template

#: Variables that do not read a metadata key.
BASE_PLACEHOLDERS = frozenset({"text", "query", "document_text", "items"})

_METADATA_PREFIX = "metadata."


@dataclass
class PromptContext:
    """Values available to one prompt rendering.

    A `None` value means the variable is unavailable in this rendering
    (no document wired, no query on an ingestion run) — referencing it is
    an error, so prompts never silently render an empty section.
    """

    text: str | None = None
    query: str | None = None
    document_text: str | None = None
    items_block: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


def referenced_placeholders(template: str) -> set[str]:
    """Return every variable a template references, rejecting unknown ones.

    Metadata references are returned whole (`metadata.author`); anything
    outside the node vocabulary raises so validation can report it.
    """
    names = referenced_variables(template)
    for name in names:
        if not _is_valid_placeholder(name):
            raise PromptTemplateError(
                f"Unknown variable '{{{{{name}}}}}'. Available: "
                "{{text}}, {{query}}, {{document_text}}, {{items}}, "
                "{{metadata.<key>}}."
            )
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
    values: dict[str, str] = {}
    for name in referenced_placeholders(template):
        if name.startswith(_METADATA_PREFIX):
            value = context.metadata.get(name[len(_METADATA_PREFIX) :])
            values[name] = "" if value is None else str(value)
            continue
        available = {
            "text": context.text,
            "query": context.query,
            "document_text": context.document_text,
            "items": context.items_block,
        }[name]
        if available is None:
            raise PromptTemplateError(
                f"Variable '{{{{{name}}}}}' is not available here — " + _unavailable_reason(name)
            )
        values[name] = available
    return render_template(template, values)


def _unavailable_reason(name: str) -> str:
    reasons = {
        "text": "this node's input items carry no text.",
        "query": "this run has no query (ingestion runs don't).",
        "document_text": "no document is wired into the node's document input.",
        "items": "only listwise prompts can render the numbered item list.",
    }
    return reasons[name]


def render_items_block(texts: list[str]) -> str:
    """Render the numbered item list a listwise prompt embeds via `{{items}}`."""
    return "\n\n".join(f"[{index + 1}] {text}" for index, text in enumerate(texts))
