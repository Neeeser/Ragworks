"""Apply validated structured-output values onto pipeline items.

Every application builds new `Item`/`DocumentMetadata` instances — items are
shared through trace snapshots and fan-out edges, so in-place mutation would
leak one node's writes into another's view of the stream.
"""

from __future__ import annotations

from typing import Any

from app.pipelines.llm.config import OutputFieldSpec, ScoreTarget, TextTarget
from app.pipelines.payloads import Item
from app.retrieval.models import DocumentMetadata


def apply_annotations(item: Item, fields: list[OutputFieldSpec], values: dict[str, Any]) -> Item:
    """Return a copy of `item` with metadata/text/score targets applied.

    Text writes compose in field order: several `prepend` fields stack in
    the order the user declared them. `items` targets are ignored here —
    the generate shell consumes those separately.
    """
    metadata = dict(item.metadata.data)
    text = item.text
    score = item.score
    metadata_changed = False
    for spec in fields:
        value = values[spec.name]
        target = spec.target
        if target.kind == "metadata":
            metadata[target.key] = value
            metadata_changed = True
        elif isinstance(target, TextTarget):
            text = _apply_text(text, str(value), target)
        elif isinstance(target, ScoreTarget):
            score = float(value)
    return item.model_copy(
        update={
            "metadata": DocumentMetadata(data=metadata) if metadata_changed else item.metadata,
            "text": text,
            "score": score,
        }
    )


def _apply_text(existing: str | None, value: str, target: TextTarget) -> str:
    if target.mode == "replace" or existing is None:
        return value
    if target.mode == "prepend":
        return f"{value}{target.separator}{existing}"
    return f"{existing}{target.separator}{value}"


def items_field(fields: list[OutputFieldSpec]) -> OutputFieldSpec | None:
    """Return the field designated as the new-items source, if any."""
    return next((spec for spec in fields if spec.target.kind == "items"), None)


def generated_texts(spec: OutputFieldSpec, values: dict[str, Any]) -> list[str]:
    """Return the non-empty strings of the items-target field's list value."""
    value = values[spec.name]
    entries = value if isinstance(value, list) else [str(value)]
    return [entry.strip() for entry in entries if isinstance(entry, str) and entry.strip()]
