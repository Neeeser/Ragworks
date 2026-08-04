"""Split oversized items before they reach the embedding model.

This is the last gate before the provider call, and it recovers rather than
refuses: an item may arrive wider than the model accepts because the authored
window overflows, or because a node on the path wrote extra text into it, and
failing the run over a condition the run can survive would strand the user's
work. `app/pipelines/embedding_limits.py` is the matching authoring-time
check that says so up front.

Text an upstream node wrote around an item's content (contextual retrieval's
situating sentence, prepended or appended) is repeated onto every part.
Splitting the whole text instead leaves the context on one end part and every
other part carrying content with none of it — the exact opposite of what the
technique exists for, and silent.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.pipelines.payloads import Item, ItemBatch, TextAffixes, TokenizerSpec
from app.providers.base import effective_embedding_input_limit
from app.retrieval.tokenizers.base import TokenCounter
from app.retrieval.tokenizers.resources import build_token_counter

if TYPE_CHECKING:
    from app.pipelines.execution.context import PipelineRunContext

#: Tokens repeated between consecutive parts, so a cut mid-sentence still
#: leaves both sides with the surrounding words.
_GUARD_OVERLAP = 32

#: Repeated affixes spend part of every part's budget. Below this share of
#: the limit left for content, repeating them would shred the item into
#: near-empty parts, so the guard splits the whole text instead and says so.
_MIN_CONTENT_SHARE = 0.25


@dataclass(frozen=True)
class _OversizeSplit:
    """What became of one item that exceeded the model's input limit."""

    parts: list[str]
    token_count: int
    #: Trailing sentence explaining what happened to the text an upstream node
    #: wrote around the content; empty when the item carried none.
    affix_note: str


def guard_items_for_embedding(
    batch: ItemBatch,
    published_limit: int | None,
    context: PipelineRunContext,
) -> ItemBatch:
    """Split oversized textual items once before they fan out to index planes.

    Split parts of a document-owned item are re-keyed to the canonical
    `{document_id}:{order}` scheme (the whole batch renumbers, so vector ids
    and per-document deletion stay consistent); free-standing items keep
    their id with a `#part` suffix.
    """
    if published_limit is None:
        return batch
    limit = effective_embedding_input_limit(published_limit)
    if limit <= 0:
        return batch

    # A whitespace tokenizer is useful for legacy chunking, but it is not an
    # estimate of model tokens. The runtime guard must use a real model
    # tokenizer whenever the configured tokenizer cannot enforce the
    # provider's limit, otherwise providers may still silently truncate the
    # parts.
    tokenizer = batch.tokenizer or TokenizerSpec(kind="wordpiece")
    if tokenizer.kind == "whitespace":
        tokenizer = TokenizerSpec(kind="wordpiece")
    counter = build_token_counter(tokenizer, context.storage.base_path)

    split_any = False
    parts_by_item: list[tuple[Item, list[str]]] = []
    for original_index, item in enumerate(batch.items):
        split = _split_oversized(item, counter, limit)
        if split is None:
            parts_by_item.append((item, [item.text or ""]))
            continue
        split_any = True
        parts_by_item.append((item, split.parts))
        if context.trace is not None:
            context.trace.record_warning(
                f"Item '{item.id}' (index {original_index}) contained "
                f"{split.token_count} tokens, exceeding the {limit}-token embedding "
                f"limit, and was split into {len(split.parts)} parts using the "
                f"{tokenizer.kind} counter.{split.affix_note}"
            )
    if not split_any:
        return batch
    return batch.model_copy(update={"items": _rekey_split_items(parts_by_item)})


def _split_oversized(item: Item, counter: TokenCounter, limit: int) -> _OversizeSplit | None:
    """Return how an item over the limit was split, or None when it fits."""
    text = item.text or ""
    token_count = counter.count(text)
    if token_count <= limit:
        return None
    content = _content_between_affixes(text, item.text_affixes)
    if content is None or item.text_affixes is None:
        return _OversizeSplit(_split_text(text, limit, counter), token_count, "")

    affixes = item.text_affixes
    affix_tokens = counter.count(affixes.prefix) + counter.count(affixes.suffix)
    content_limit = limit - affix_tokens
    if content_limit < max(1, int(limit * _MIN_CONTENT_SHARE)):
        return _OversizeSplit(
            _split_text(text, limit, counter),
            token_count,
            f" Its {affix_tokens} tokens of surrounding text leave too little of the "
            "limit for content, so the parts do not each carry it.",
        )
    parts = [affixes.wrap(part) for part in _split_text(content, content_limit, counter)]
    return _OversizeSplit(
        parts,
        token_count,
        f" The {affix_tokens}-token text written around it upstream is repeated "
        "on every part.",
    )


def _content_between_affixes(text: str, affixes: TextAffixes | None) -> str | None:
    """Return the item's own content, or None when the affixes don't frame it.

    A node that rewrote the text outside the mapping layer would leave a
    stale annotation behind; slicing on it anyway would cut real content off
    both ends, so an annotation that no longer frames the text is ignored
    rather than trusted.
    """
    if affixes is None or affixes.empty:
        return None
    if not text.startswith(affixes.prefix) or not text.endswith(affixes.suffix):
        return None
    end = len(text) - len(affixes.suffix)
    if end <= len(affixes.prefix):
        return None
    return text[len(affixes.prefix) : end]


def _split_text(text: str, limit: int, counter: TokenCounter) -> list[str]:
    """Split text into parts of at most `limit` tokens.

    Overlap is *added* to the size the splitter is given, so the size has to
    leave room for it — splitting at the full limit plus an overlap would emit
    parts over the very limit this guard enforces.
    """
    overlap = min(_GUARD_OVERLAP, max(0, limit - 1))
    return counter.split(text, chunk_size=max(1, limit - overlap), overlap=overlap)


def _rekey_split_items(parts_by_item: list[tuple[Item, list[str]]]) -> list[Item]:
    """Re-key a batch whose oversized items were split into parts.

    Document-owned batches renumber to the canonical `{document_id}:{order}`
    scheme so vector ids and per-document deletion stay consistent;
    free-standing items keep their id, with a `#part` suffix when split.
    """
    renumber = all(item.document_id is not None for item, _ in parts_by_item)
    rekeyed: list[Item] = []
    for item, parts in parts_by_item:
        for part_index, text in enumerate(parts):
            if renumber:
                order = len(rekeyed)
                item_id = f"{item.document_id}:{order}"
            else:
                order = item.order if item.order is not None else len(rekeyed)
                item_id = item.id if len(parts) == 1 else f"{item.id}#{part_index}"
            rekeyed.append(
                item.model_copy(
                    update={
                        "id": item_id,
                        "text": text,
                        "order": order,
                        "metadata": item.metadata.model_copy(deep=True),
                    }
                )
            )
    return rekeyed
