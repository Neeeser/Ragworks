"""Behavior of the result-shaping nodes: deduplication and score threshold.

Both narrow an ordered result stream, so what matters is exactly which items
survive, in which order, and that the trace states the outcome even when the
node produced nothing.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import EmptyConfig
from app.pipelines.nodes.limiting import (
    DeduplicateResultsNode,
    ScoreThresholdConfig,
    ScoreThresholdNode,
)
from app.pipelines.payloads import Item, ItemBatch
from app.pipelines.registry import build_default_registry
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider


def _item(chunk_id: str, score: float | None, *, document_id: str = "doc") -> Item:
    return Item(id=chunk_id, text=chunk_id, score=score, document_id=document_id)


def _context(session: Session) -> PipelineRunContext:
    """A minimal retrieval-run context; these nodes read no run state."""
    user = models.User(id=uuid4(), email="shaping@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(), user_id=user.id, name="Shaping", description="", extra_metadata={}
    )
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=None,
        query="hello",
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(None),
        storage=FileStorage(base_path=Path("/tmp/result-shaping-tests")),
        settings=get_settings(),
    )


def _ids(outputs: dict[str, object]) -> list[str]:
    return [item.id for item in ItemBatch.model_validate(outputs["items"]).items]


def _scores(outputs: dict[str, object]) -> list[float | None]:
    return [item.score for item in ItemBatch.model_validate(outputs["items"]).items]


class TestDeduplicateResultsNode:
    """One occurrence per chunk, the best-scored one, in the input's order."""

    def test_keeps_the_highest_scored_occurrence_at_the_first_position(
        self, session: Session
    ) -> None:
        batch = ItemBatch(items=[_item("doc:0", 0.4), _item("doc:1", 0.7), _item("doc:0", 0.9)])
        outputs = DeduplicateResultsNode(EmptyConfig()).run({"items": batch}, _context(session))
        assert _ids(outputs) == ["doc:0", "doc:1"]
        assert _scores(outputs) == [0.9, 0.7]

    def test_keeps_the_first_occurrence_on_a_tie(self, session: Session) -> None:
        first = _item("doc:0", 0.5)
        first.metadata.data["branch"] = "semantic"
        second = _item("doc:0", 0.5)
        second.metadata.data["branch"] = "bm25"
        outputs = DeduplicateResultsNode(EmptyConfig()).run(
            {"items": ItemBatch(items=[first, second])}, _context(session)
        )
        items = ItemBatch.model_validate(outputs["items"]).items
        assert [item.metadata.data["branch"] for item in items] == ["semantic"]

    def test_same_chunk_id_under_different_documents_stays_distinct(self, session: Session) -> None:
        batch = ItemBatch(
            items=[
                _item("chunk", 0.9, document_id="a"),
                _item("chunk", 0.8, document_id="b"),
            ]
        )
        outputs = DeduplicateResultsNode(EmptyConfig()).run({"items": batch}, _context(session))
        assert len(ItemBatch.model_validate(outputs["items"]).items) == 2

    def test_unscored_duplicates_collapse_to_the_scored_occurrence(self, session: Session) -> None:
        batch = ItemBatch(items=[_item("doc:0", None), _item("doc:0", 0.2)])
        outputs = DeduplicateResultsNode(EmptyConfig()).run({"items": batch}, _context(session))
        assert _scores(outputs) == [0.2]

    def test_empty_input_produces_empty_output(self, session: Session) -> None:
        outputs = DeduplicateResultsNode(EmptyConfig()).run(
            {"items": ItemBatch()}, _context(session)
        )
        assert _ids(outputs) == []

    def test_trace_states_how_many_duplicates_were_removed(self, session: Session) -> None:
        batch = ItemBatch(items=[_item("doc:0", 0.9), _item("doc:0", 0.4), _item("doc:1", 0.3)])
        node = DeduplicateResultsNode(EmptyConfig())
        outputs = node.run({"items": batch}, _context(session))
        summary = node.summarize_io({"items": batch}, outputs)
        kept = next(value.value for value in summary.outputs if value.label == "Kept")
        assert kept == {"kept": 2, "duplicates_removed": 1}
        candidates = next(
            value.value for value in summary.inputs if value.label == "Candidate items"
        )
        assert len(candidates.items) == 3


class TestScoreThresholdNode:
    """Below the minimum is dropped; exactly the minimum is kept."""

    @pytest.mark.parametrize(
        ("score", "kept"),
        [(0.49, False), (0.5, True), (0.51, True)],
    )
    def test_boundary_is_inclusive(self, session: Session, score: float, kept: bool) -> None:
        node = ScoreThresholdNode(ScoreThresholdConfig(min_score=0.5))
        outputs = node.run({"items": ItemBatch(items=[_item("doc:0", score)])}, _context(session))
        assert _ids(outputs) == (["doc:0"] if kept else [])

    def test_unset_minimum_keeps_every_item_including_negative_scores(
        self, session: Session
    ) -> None:
        """A reranker scores relevant results below zero; an unconfigured node cuts nothing."""
        batch = ItemBatch(items=[_item("doc:0", -4.2), _item("doc:1", 0.8)])
        node = ScoreThresholdNode(ScoreThresholdConfig())
        assert _ids(node.run({"items": batch}, _context(session))) == ["doc:0", "doc:1"]

    def test_a_negative_minimum_still_cuts(self, session: Session) -> None:
        batch = ItemBatch(items=[_item("doc:0", -4.2), _item("doc:1", -0.5)])
        node = ScoreThresholdNode(ScoreThresholdConfig(min_score=-1.0))
        assert _ids(node.run({"items": batch}, _context(session))) == ["doc:1"]

    def test_preserves_the_order_it_received(self, session: Session) -> None:
        batch = ItemBatch(items=[_item("doc:2", 0.9), _item("doc:0", 0.1), _item("doc:1", 0.6)])
        node = ScoreThresholdNode(ScoreThresholdConfig(min_score=0.5))
        assert _ids(node.run({"items": batch}, _context(session))) == ["doc:2", "doc:1"]

    def test_an_unscored_item_is_dropped(self, session: Session) -> None:
        """Nothing established that an unscored item clears the bar."""
        batch = ItemBatch(items=[_item("doc:0", None), _item("doc:1", 0.8)])
        node = ScoreThresholdNode(ScoreThresholdConfig(min_score=0.5))
        assert _ids(node.run({"items": batch}, _context(session))) == ["doc:1"]

    def test_empty_input_produces_empty_output(self, session: Session) -> None:
        node = ScoreThresholdNode(ScoreThresholdConfig(min_score=0.5))
        assert _ids(node.run({"items": ItemBatch()}, _context(session))) == []

    def test_trace_states_the_threshold_and_an_empty_outcome(self, session: Session) -> None:
        batch = ItemBatch(items=[_item("doc:0", 0.2), _item("doc:1", 0.1)])
        node = ScoreThresholdNode(ScoreThresholdConfig(min_score=0.5))
        outputs = node.run({"items": batch}, _context(session))
        summary = node.summarize_io({"items": batch}, outputs)
        kept = next(value.value for value in summary.outputs if value.label == "Kept")
        assert kept == {"min_score": 0.5, "kept": 0, "dropped": 2}
        kept_items = next(value.value for value in summary.outputs if value.label == "Kept items")
        assert kept_items.items == []

    def test_input_port_requires_a_score(self) -> None:
        """The graph must guarantee the facet the node filters on."""
        spec = build_default_registry().get_spec(ScoreThresholdNode.type)
        assert spec is not None
        assert spec.input_ports[0].requires == ("score",)
