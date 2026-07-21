"""Context sampling: determinism, size weighting, caps, and window shapes."""

from __future__ import annotations

import random

from app.evals.generation.contexts import (
    DocumentPlan,
    pick_distractor_positions,
    sample_contexts,
)
from app.schemas.enums import EvalQuestionType

_MIX = {
    EvalQuestionType.SINGLE_FACT: 0.5,
    EvalQuestionType.PARAPHRASED: 0.25,
    EvalQuestionType.MULTI_DETAIL: 0.25,
}


def _docs() -> list[DocumentPlan]:
    return [
        DocumentPlan(doc_id="doc-a", title="A", chunk_count=40),
        DocumentPlan(doc_id="doc-b", title="B", chunk_count=10),
        DocumentPlan(doc_id="doc-c", title="C", chunk_count=1),
    ]


class TestSampleContexts:
    """The seeded planner."""

    def test_same_seed_same_plan(self) -> None:
        """A fixed seed reproduces the exact context plan."""
        first = sample_contexts(_docs(), count=30, type_mix=_MIX, seed=7)
        second = sample_contexts(_docs(), count=30, type_mix=_MIX, seed=7)
        assert first == second

    def test_different_seed_changes_plan(self) -> None:
        """Changing the seed changes the sampled windows."""
        first = sample_contexts(_docs(), count=30, type_mix=_MIX, seed=7)
        second = sample_contexts(_docs(), count=30, type_mix=_MIX, seed=8)
        assert first != second

    def test_windows_stay_inside_their_document(self) -> None:
        """Every window fits within its document's chunk range."""
        by_id = {doc.doc_id: doc for doc in _docs()}
        for plan in sample_contexts(_docs(), count=50, type_mix=_MIX, seed=3):
            doc = by_id[plan.doc_id]
            assert plan.start_index >= 0
            assert plan.start_index + plan.span <= doc.chunk_count

    def test_multi_detail_spans_multiple_chunks_when_possible(self) -> None:
        """multi_detail windows cover 2+ chunks unless the document has one."""
        mix = {EvalQuestionType.MULTI_DETAIL: 1.0}
        for plan in sample_contexts(_docs(), count=30, type_mix=mix, seed=5):
            by_id = {doc.doc_id: doc for doc in _docs()}
            expected_min = 2 if by_id[plan.doc_id].chunk_count >= 2 else 1
            assert plan.span >= expected_min

    def test_zero_weight_type_never_sampled(self) -> None:
        """A type with weight zero is excluded from the plan."""
        mix = {EvalQuestionType.SINGLE_FACT: 1.0, EvalQuestionType.PARAPHRASED: 0.0}
        plans = sample_contexts(_docs(), count=40, type_mix=mix, seed=1)
        assert {plan.question_type for plan in plans} == {EvalQuestionType.SINGLE_FACT}

    def test_no_eligible_documents_yields_no_plans(self) -> None:
        """Empty or chunkless collections produce an empty plan."""
        empty = [DocumentPlan(doc_id="doc-x", title="X", chunk_count=0)]
        assert sample_contexts(empty, count=10, type_mix=_MIX, seed=0) == []

    def test_large_document_is_capped(self) -> None:
        """One oversized document cannot absorb the whole plan."""
        docs = [DocumentPlan(doc_id="doc-big", title="Big", chunk_count=1000)] + [
            DocumentPlan(doc_id=f"doc-{index}", title="Small", chunk_count=5)
            for index in range(4)
        ]
        plans = sample_contexts(docs, count=20, type_mix=_MIX, seed=2)
        big_share = sum(1 for plan in plans if plan.doc_id == "doc-big")
        assert big_share <= 8  # per_document_cap(20, 5) = ceil(20/5) * 2


class TestDistractors:
    """Distractor position picking."""

    def test_distractors_come_from_other_documents(self) -> None:
        """No distractor is drawn from the context's own document."""
        docs = _docs()
        plans = sample_contexts(docs, count=10, type_mix=_MIX, seed=4)
        rng = random.Random(0)
        for plan in plans:
            for doc_id, index in pick_distractor_positions(docs, plan, rng=rng):
                assert doc_id != plan.doc_id
                assert index >= 0

    def test_single_document_collection_has_no_distractors(self) -> None:
        """With one document there is nothing to contrast against."""
        docs = [DocumentPlan(doc_id="only", title="Only", chunk_count=8)]
        plan = sample_contexts(docs, count=1, type_mix=_MIX, seed=0)[0]
        assert pick_distractor_positions(docs, plan, rng=random.Random(0)) == []
