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
from app.pipelines.payloads import Item, TextAffixes


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


def test_prepending_records_what_was_put_in_front_of_the_content() -> None:
    """The embedding guard needs the affixes to repeat them onto every split part."""
    item = Item(id="c1", text="original")
    spec = OutputFieldSpec(
        name="context",
        type="string",
        target=TextTarget(mode="prepend", separator="\n\n"),
    )
    updated = apply_annotations(item, [spec], {"context": "situating"})
    assert updated.text_affixes == TextAffixes(prefix="situating\n\n")
    assert updated.text == "situating\n\noriginal"


def test_appending_records_what_was_put_after_the_content() -> None:
    """An appended affix is severed by a split exactly like a prepended one."""
    item = Item(id="c1", text="original")
    spec = OutputFieldSpec(
        name="context",
        type="string",
        target=TextTarget(mode="append", separator="\n\n"),
    )
    updated = apply_annotations(item, [spec], {"context": "situating"})
    assert updated.text_affixes == TextAffixes(suffix="\n\nsituating")
    assert updated.text == "original\n\nsituating"


def test_stacked_prepends_record_the_whole_prefix_in_front_of_the_content() -> None:
    item = Item(id="c1", text="body")
    fields = [
        OutputFieldSpec(name="a", type="string", target=TextTarget(mode="prepend", separator="|")),
        OutputFieldSpec(name="b", type="string", target=TextTarget(mode="prepend", separator="|")),
    ]
    updated = apply_annotations(item, fields, {"a": "one", "b": "two"})
    assert updated.text == "two|one|body"
    assert updated.text_affixes == TextAffixes(prefix="two|one|")


def test_stacked_appends_record_the_whole_suffix_after_the_content() -> None:
    item = Item(id="c1", text="body")
    fields = [
        OutputFieldSpec(name="a", type="string", target=TextTarget(mode="append", separator="|")),
        OutputFieldSpec(name="b", type="string", target=TextTarget(mode="append", separator="|")),
    ]
    updated = apply_annotations(item, fields, {"a": "one", "b": "two"})
    assert updated.text == "body|one|two"
    assert updated.text_affixes == TextAffixes(suffix="|one|two")


def test_both_affixes_are_recorded_around_the_content() -> None:
    item = Item(id="c1", text="body")
    fields = [
        OutputFieldSpec(name="a", type="string", target=TextTarget(mode="prepend", separator="|")),
        OutputFieldSpec(name="b", type="string", target=TextTarget(mode="append", separator="|")),
    ]
    updated = apply_annotations(item, fields, {"a": "head", "b": "tail"})
    assert updated.text == "head|body|tail"
    affixes = updated.text_affixes
    assert affixes is not None
    assert affixes.wrap("body") == updated.text


def test_replacing_the_text_clears_both_recorded_affixes() -> None:
    """The replaced text is the model's whole answer; nothing surrounds content."""
    item = Item(
        id="c1",
        text="head\n\nbody\n\ntail",
        text_affixes=TextAffixes(prefix="head\n\n", suffix="\n\ntail"),
    )
    spec = OutputFieldSpec(name="summary", type="string", target=TextTarget(mode="replace"))
    updated = apply_annotations(item, [spec], {"summary": "short"})
    assert updated.text == "short"
    assert updated.text_affixes is None


def test_score_target_sets_score() -> None:
    item = Item(id="c1", text="body", score=0.2)
    spec = OutputFieldSpec(name="relevance", type="number", target=ScoreTarget())
    updated = apply_annotations(item, [spec], {"relevance": 0.87})
    assert updated.score == 0.87


def test_items_field_and_generated_texts_drop_blanks() -> None:
    spec = OutputFieldSpec(name="queries", type="string_list", target=ItemsTarget())
    assert items_field([spec]) is spec
    assert generated_texts(spec, {"queries": [" a ", "", "b"]}) == ["a", "b"]
