"""Splitting oversized items before they reach the embedding model."""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.embedding_guard import guard_items_for_embedding
from app.pipelines.payloads import Item, ItemBatch, TextAffixes, TokenizerSpec
from app.retrieval.tokenizers.resources import build_token_counter
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider

#: The guard subtracts a safety margin from the published limit, so the
#: numbers asserted below are the effective limit, not this one.
PUBLISHED_LIMIT = 96


class _RecordingTrace:
    """Captures the warnings the guard records, standing in for the recorder."""

    def __init__(self) -> None:
        self.warnings: list[str] = []

    def record_warning(self, warning: str) -> None:
        self.warnings.append(warning)


def _context() -> PipelineRunContext:
    user = models.User(id=uuid4(), email="guard@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(), user_id=user.id, name="Guard", description="", extra_metadata={}
    )
    return PipelineRunContext(
        session=Session(),
        user=user,
        collection=collection,
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(),
        settings=get_settings(),
        trace=_RecordingTrace(),
    )


def _counter(context: PipelineRunContext) -> object:
    return build_token_counter(TokenizerSpec(kind="wordpiece"), context.storage.base_path)


def _content(words: int) -> str:
    return " ".join(f"sentence{index} about quarterly revenue growth" for index in range(words))


def test_a_split_item_repeats_its_prepended_prefix_on_every_part() -> None:
    """Contextual retrieval is pointless if only the first part keeps the context.

    The guard splits the whole item text, so without carrying the affix every
    part after the first arrives at the model as bare content.
    """
    context = _context()
    counter = _counter(context)
    prefix = "This chunk is from the 2025 annual report, revenue section.\n\n"
    batch = ItemBatch(
        items=[
            Item(
                id="doc:0",
                text=prefix + _content(40),
                document_id="doc",
                order=0,
                text_affixes=TextAffixes(prefix=prefix),
            )
        ],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    guarded = guard_items_for_embedding(batch, PUBLISHED_LIMIT, context)

    limit = PUBLISHED_LIMIT - 16
    assert len(guarded.items) > 1
    assert all(item.text is not None and item.text.startswith(prefix) for item in guarded.items)
    assert all(counter.count(item.text or "") <= limit for item in guarded.items)
    assert "repeated on every part" in context.trace.warnings[0]


def test_a_split_item_repeats_its_appended_suffix_on_every_part() -> None:
    """`append` severs the same way `prepend` does, so it is carried the same way."""
    context = _context()
    counter = _counter(context)
    suffix = "\n\nThis chunk is from the 2025 annual report, revenue section."
    batch = ItemBatch(
        items=[
            Item(
                id="doc:0",
                text=_content(40) + suffix,
                document_id="doc",
                order=0,
                text_affixes=TextAffixes(suffix=suffix),
            )
        ],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    guarded = guard_items_for_embedding(batch, PUBLISHED_LIMIT, context)

    limit = PUBLISHED_LIMIT - 16
    assert len(guarded.items) > 1
    assert all(item.text is not None and item.text.endswith(suffix) for item in guarded.items)
    assert all(counter.count(item.text or "") <= limit for item in guarded.items)
    assert "repeated on every part" in context.trace.warnings[0]


def test_a_chunk_wrapped_on_both_sides_keeps_both_and_still_fits() -> None:
    context = _context()
    counter = _counter(context)
    affixes = TextAffixes(prefix="Annual report, revenue.\n\n", suffix="\n\nSource: 10-K, page 4.")
    batch = ItemBatch(
        items=[
            Item(
                id="doc:0",
                text=affixes.wrap(_content(40)),
                document_id="doc",
                order=0,
                text_affixes=affixes,
            )
        ],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    guarded = guard_items_for_embedding(batch, PUBLISHED_LIMIT, context)

    limit = PUBLISHED_LIMIT - 16
    assert len(guarded.items) > 1
    for item in guarded.items:
        assert item.text is not None
        assert item.text.startswith(affixes.prefix)
        assert item.text.endswith(affixes.suffix)
        assert counter.count(item.text) <= limit


def test_an_item_with_no_affixes_still_splits_within_the_limit() -> None:
    context = _context()
    counter = _counter(context)
    batch = ItemBatch(
        items=[Item(id="doc:0", text=_content(40), document_id="doc", order=0)],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    guarded = guard_items_for_embedding(batch, PUBLISHED_LIMIT, context)

    limit = PUBLISHED_LIMIT - 16
    assert len(guarded.items) > 1
    assert all(counter.count(item.text or "") <= limit for item in guarded.items)
    assert "repeated on every part" not in context.trace.warnings[0]


def test_affixes_leaving_no_room_for_content_are_not_repeated() -> None:
    """Repeating them would shred the item into near-empty parts, so say so instead."""
    context = _context()
    counter = _counter(context)
    affixes = TextAffixes(prefix=_content(20) + "\n\n")
    text = affixes.wrap(_content(20))
    batch = ItemBatch(
        items=[Item(id="doc:0", text=text, document_id="doc", order=0, text_affixes=affixes)],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    guarded = guard_items_for_embedding(batch, PUBLISHED_LIMIT, context)

    limit = PUBLISHED_LIMIT - 16
    assert all(counter.count(item.text or "") <= limit for item in guarded.items)
    assert not all(
        item.text is not None and item.text.startswith(affixes.prefix) for item in guarded.items
    )
    assert "do not each carry it" in context.trace.warnings[0]


def test_split_parts_keep_their_affix_annotation_for_downstream_nodes() -> None:
    context = _context()
    affixes = TextAffixes(prefix="Situating context.\n\n")
    batch = ItemBatch(
        items=[
            Item(
                id="doc:0",
                text=affixes.wrap(_content(40)),
                document_id="doc",
                order=0,
                text_affixes=affixes,
            )
        ],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    guarded = guard_items_for_embedding(batch, PUBLISHED_LIMIT, context)

    assert {item.text_affixes for item in guarded.items} == {affixes}
    assert [item.id for item in guarded.items] == [
        f"doc:{index}" for index in range(len(guarded.items))
    ]


def test_an_item_within_the_limit_is_returned_untouched() -> None:
    context = _context()
    batch = ItemBatch(
        items=[Item(id="doc:0", text="short text", document_id="doc", order=0)],
        tokenizer=TokenizerSpec(kind="wordpiece"),
    )

    assert guard_items_for_embedding(batch, PUBLISHED_LIMIT, context) == batch
    assert context.trace.warnings == []
