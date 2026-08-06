"""Apply validated structured-output values onto pipeline items.

Every application builds new `Item`/`DocumentMetadata` instances — items are
shared through trace snapshots and fan-out edges, so in-place mutation would
leak one node's writes into another's view of the stream.
"""

from __future__ import annotations

from typing import Any

from app.pipelines.llm.config import OutputFieldSpec, ScoreTarget, TextTarget
from app.pipelines.payloads import Item, TextAffixes
from app.retrieval.models import DocumentMetadata


def apply_annotations(item: Item, fields: list[OutputFieldSpec], values: dict[str, Any]) -> Item:
    """Return a copy of `item` with metadata/text/score targets applied.

    Text writes compose in field order: several `prepend` fields stack in
    the order the user declared them. `items` targets are ignored here —
    the generate shell consumes those separately.

    Rewriting the text discards the annotations computed from the old
    text: the item's embedding, and any score it arrived with. A score
    this call itself writes is the node's own output and stands, and a
    field set that only writes metadata leaves the content — and so the
    vector describing it — untouched.
    """
    metadata = dict(item.metadata.data)
    text = item.text
    affixes = item.text_affixes or TextAffixes()
    score = item.score
    metadata_changed = False
    text_changed = False
    score_written = False
    for spec in fields:
        value = values[spec.name]
        target = spec.target
        if target.kind == "metadata":
            metadata[target.key] = value
            metadata_changed = True
        elif isinstance(target, TextTarget):
            text, affixes = _apply_text(text, affixes, str(value), target)
            text_changed = True
        elif isinstance(target, ScoreTarget):
            score = float(value)
            score_written = True
    if text_changed and not score_written:
        score = None
    return item.model_copy(
        update={
            "metadata": DocumentMetadata(data=metadata) if metadata_changed else item.metadata,
            "text": text,
            "text_affixes": None if affixes.empty else affixes,
            "score": score,
            "embedding": None if text_changed else item.embedding,
        }
    )


def _apply_text(
    existing: str | None, affixes: TextAffixes, value: str, target: TextTarget
) -> tuple[str, TextAffixes]:
    """Return the item's new text and what now surrounds its content.

    The affixes are recorded so the embedding guard can repeat them onto
    every part of an item it has to split — written context that survives on
    one part only is the opposite of what writing it was for, and that is as
    true of an `append` as of a `prepend`. A `replace` discards the content,
    so nothing surrounds it any more.
    """
    if target.mode == "replace" or existing is None:
        return value, TextAffixes()
    if target.mode == "prepend":
        return (
            f"{value}{target.separator}{existing}",
            TextAffixes(
                prefix=f"{value}{target.separator}{affixes.prefix}", suffix=affixes.suffix
            ),
        )
    return (
        f"{existing}{target.separator}{value}",
        TextAffixes(prefix=affixes.prefix, suffix=f"{affixes.suffix}{target.separator}{value}"),
    )


def items_field(fields: list[OutputFieldSpec]) -> OutputFieldSpec | None:
    """Return the field designated as the new-items source, if any."""
    return next((spec for spec in fields if spec.target.kind == "items"), None)


def generated_texts(spec: OutputFieldSpec, values: dict[str, Any]) -> list[str]:
    """Return the non-empty strings of the items-target field's list value."""
    value = values[spec.name]
    entries = value if isinstance(value, list) else [str(value)]
    return [entry.strip() for entry in entries if isinstance(entry, str) and entry.strip()]
