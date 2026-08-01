"""Applying structured-output values onto items."""

from __future__ import annotations

from app.pipelines.llm.config import (
    ItemsTarget,
    MetadataTarget,
    OutputFieldSpec,
    ScoreTarget,
    TextTarget,
)
from app.pipelines.llm.mapping import apply_annotations, generated_texts, items_field
from app.pipelines.payloads import Item


def test_metadata_target_builds_new_metadata() -> None:
    item = Item(id="c1", text="body")
    spec = OutputFieldSpec(name="author", type="string", target=MetadataTarget(key="author"))
    updated = apply_annotations(item, [spec], {"author": "Smith"})
    assert updated.metadata.data == {"author": "Smith"}
    assert item.metadata.data == {}  # original untouched


def test_text_prepend_uses_separator_and_keeps_id() -> None:
    item = Item(id="c1", text="original")
    spec = OutputFieldSpec(
        name="context",
        type="string",
        target=TextTarget(mode="prepend", separator=" | "),
    )
    updated = apply_annotations(item, [spec], {"context": "situating"})
    assert updated.text == "situating | original"
    assert updated.id == "c1"


def test_text_writes_compose_in_field_order() -> None:
    item = Item(id="c1", text="base")
    fields = [
        OutputFieldSpec(name="a", type="string", target=TextTarget(mode="append", separator="+")),
        OutputFieldSpec(name="b", type="string", target=TextTarget(mode="append", separator="+")),
    ]
    updated = apply_annotations(item, fields, {"a": "one", "b": "two"})
    assert updated.text == "base+one+two"


def test_score_target_sets_score() -> None:
    item = Item(id="c1", text="body", score=0.2)
    spec = OutputFieldSpec(name="relevance", type="number", target=ScoreTarget())
    updated = apply_annotations(item, [spec], {"relevance": 0.87})
    assert updated.score == 0.87


def test_items_field_and_generated_texts_drop_blanks() -> None:
    spec = OutputFieldSpec(name="queries", type="string_list", target=ItemsTarget())
    assert items_field([spec]) is spec
    assert generated_texts(spec, {"queries": [" a ", "", "b"]}) == ["a", "b"]
