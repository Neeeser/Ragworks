"""Context sampling: determinism, corpus coverage, and window shapes."""

from __future__ import annotations

import random
from collections import Counter

from app.evals.generation.contexts import (
    DocumentPlan,
    pick_distractor_positions,
    sample_contexts,
)
from app.schemas.enums import EvalModality, EvalQuestionType

_MIX = {
    EvalQuestionType.SINGLE_FACT: 0.5,
    EvalQuestionType.PARAPHRASED: 0.25,
    EvalQuestionType.MULTI_DETAIL: 0.25,
}


def _docs() -> list[DocumentPlan]:
    return [
        DocumentPlan(doc_id="doc-a", title="A", text_chunk_count=40),
        DocumentPlan(doc_id="doc-b", title="B", text_chunk_count=10),
        DocumentPlan(doc_id="doc-c", title="C", text_chunk_count=1),
    ]


def _corpus(size: int) -> list[DocumentPlan]:
    """A corpus of equally sized documents, one per coverage slot."""
    return [
        DocumentPlan(doc_id=f"doc-{index}", title=f"Doc {index}", text_chunk_count=8)
        for index in range(size)
    ]


def _uneven() -> list[DocumentPlan]:
    """One manual beside four short notes."""
    return [DocumentPlan(doc_id="doc-big", title="Big", text_chunk_count=1000)] + [
        DocumentPlan(doc_id=f"doc-{index}", title="Small", text_chunk_count=5)
        for index in range(4)
    ]


def _mixed_docs() -> list[DocumentPlan]:
    """A page-image report, a mixed PDF, and a plain text note."""
    return [
        DocumentPlan(doc_id="pages", title="Slides", image_chunk_count=30),
        DocumentPlan(doc_id="mixed", title="Report", text_chunk_count=12, image_chunk_count=8),
        DocumentPlan(doc_id="notes", title="Notes", text_chunk_count=6),
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
        empty = [DocumentPlan(doc_id="doc-x", title="X")]
        assert sample_contexts(empty, count=10, type_mix=_MIX, seed=0) == []


class TestCoverageFirstRota:
    """Every document is planned a window before any document gets a second."""

    def test_a_quota_matching_the_corpus_covers_every_document_once(self) -> None:
        """N questions over N documents plan one window each, never two of one."""
        docs = _corpus(6)
        plans = sample_contexts(docs, count=6, type_mix=_MIX, seed=17)
        assert Counter(plan.doc_id for plan in plans) == {doc.doc_id: 1 for doc in docs}

    def test_a_doubled_quota_covers_every_document_twice(self) -> None:
        """The rule repeats per pass: 2N windows means two per document."""
        docs = _corpus(6)
        plans = sample_contexts(docs, count=12, type_mix=_MIX, seed=17)
        assert Counter(plan.doc_id for plan in plans) == {doc.doc_id: 2 for doc in docs}

    def test_a_quota_below_the_corpus_reaches_that_many_documents(self) -> None:
        """Fewer questions than documents means a subset, still one each.

        Swept across seeds: one lucky seed can spread a weighted draw evenly
        by chance, so a single-seed assertion would hold for the seed rather
        than for the rule.
        """
        for seed in range(12):
            plans = sample_contexts(_corpus(6), count=4, type_mix=_MIX, seed=seed)
            assert len({plan.doc_id for plan in plans}) == 4

    def test_an_uneven_quota_spreads_the_remainder_one_document_deep(self) -> None:
        """A partial final pass never gives one document a third window."""
        counts = Counter(
            plan.doc_id for plan in sample_contexts(_corpus(5), count=8, type_mix=_MIX, seed=3)
        )
        assert sorted(counts.values()) == [1, 1, 2, 2, 2]

    def test_the_surplus_beyond_the_floor_follows_size(self) -> None:
        """Past one window each, a 1000-chunk manual outweighs a 5-chunk note."""
        docs = _uneven()
        counts = Counter(
            plan.doc_id for plan in sample_contexts(docs, count=20, seed=2, type_mix=_MIX)
        )
        assert all(counts[doc.doc_id] >= 1 for doc in docs)
        assert counts["doc-big"] > sum(counts[f"doc-{index}"] for index in range(4))

    def test_the_floor_outranks_size(self) -> None:
        """A quota matching the corpus covers it, however lopsided the sizes."""
        counts = Counter(
            plan.doc_id for plan in sample_contexts(_uneven(), count=5, seed=2, type_mix=_MIX)
        )
        assert set(counts.values()) == {1}

    def test_a_document_is_never_planned_more_windows_than_it_has_chunks(self) -> None:
        """A small document stops earning windows once its positions run out.

        Swept across seeds: the ceiling has to hold for every rota order, not
        for the one a lucky shuffle produces.
        """
        docs = [
            DocumentPlan(doc_id="doc-mid", title="Mid", text_chunk_count=12),
            DocumentPlan(doc_id="doc-note", title="Note", text_chunk_count=3),
            DocumentPlan(doc_id="doc-stub", title="Stub", text_chunk_count=1),
        ]
        for seed in range(8):
            counts = Counter(
                plan.doc_id for plan in sample_contexts(docs, count=80, seed=seed, type_mix=_MIX)
            )
            assert all(counts[doc.doc_id] <= doc.chunk_count for doc in docs)

    def test_a_quota_beyond_the_corpus_capacity_plans_what_exists(self) -> None:
        """Nothing pads the plan with windows that could only repeat a position.

        Every planned window costs a generation call, so asking for more than
        the corpus can distinctly answer returns fewer plans rather than
        billing for questions the dedup discards.
        """
        docs = [
            DocumentPlan(doc_id="doc-a", title="A", text_chunk_count=4),
            DocumentPlan(doc_id="doc-b", title="B", text_chunk_count=2),
        ]
        assert len(sample_contexts(docs, count=50, seed=1, type_mix=_MIX)) == 6

    def test_each_pass_visits_every_document_in_one_repeated_order(self) -> None:
        """The rota is one shuffled order, cycled — not a fresh draw per pass.

        Every pass is the same permutation of the whole corpus, which is what
        makes "one question each before any second" hold position by position
        rather than only in the totals.
        """
        docs = _corpus(6)
        order = [plan.doc_id for plan in sample_contexts(docs, count=18, type_mix=_MIX, seed=21)]
        assert order[:6] == order[6:12] == order[12:]
        assert set(order[:6]) == {doc.doc_id for doc in docs}


class TestModalitySampling:
    """Which model reads a window, decided per document."""

    def test_text_only_collection_plans_only_text(self) -> None:
        """Nothing invents an image window for a corpus with no page images."""
        plans = sample_contexts(_docs(), count=25, type_mix=_MIX, seed=11)
        assert {plan.modality for plan in plans} == {EvalModality.TEXT}

    def test_mixed_collection_plans_both_modalities(self) -> None:
        """A corpus holding both gets windows of both, weighted per document."""
        plans = sample_contexts(_mixed_docs(), count=40, type_mix=_MIX, seed=4)
        assert {plan.modality for plan in plans} == {EvalModality.TEXT, EvalModality.IMAGE}

    def test_mixed_sampling_is_deterministic(self) -> None:
        """The same seed reproduces the same modality assignment, window for window."""
        first = sample_contexts(_mixed_docs(), count=40, type_mix=_MIX, seed=4)
        second = sample_contexts(_mixed_docs(), count=40, type_mix=_MIX, seed=4)
        assert first == second
        assert [plan.modality for plan in first] == [plan.modality for plan in second]

    def test_image_windows_are_always_one_chunk(self) -> None:
        """A page is the unit: even a multi_detail image window covers one page."""
        mix = {EvalQuestionType.MULTI_DETAIL: 1.0}
        plans = sample_contexts(_mixed_docs(), count=40, type_mix=mix, seed=6)
        image_plans = [plan for plan in plans if plan.modality is EvalModality.IMAGE]
        assert image_plans
        assert all(plan.span == 1 for plan in image_plans)

    def test_windows_index_within_their_own_modality(self) -> None:
        """`start_index` addresses the modality's chunk list, not the whole document."""
        by_id = {doc.doc_id: doc for doc in _mixed_docs()}
        for plan in sample_contexts(_mixed_docs(), count=60, type_mix=_MIX, seed=9):
            available = by_id[plan.doc_id].count_for(plan.modality)
            assert plan.start_index >= 0
            assert plan.start_index + plan.span <= available

    def test_an_image_only_document_never_plans_a_text_window(self) -> None:
        """A document with no text chunks contributes only image contexts."""
        plans = sample_contexts(_mixed_docs(), count=60, type_mix=_MIX, seed=13)
        pages = [plan for plan in plans if plan.doc_id == "pages"]
        assert pages
        assert all(plan.modality is EvalModality.IMAGE for plan in pages)


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
        docs = [DocumentPlan(doc_id="only", title="Only", text_chunk_count=8)]
        plan = sample_contexts(docs, count=1, type_mix=_MIX, seed=0)[0]
        assert pick_distractor_positions(docs, plan, rng=random.Random(0)) == []

    def test_distractors_are_text_positions_only(self) -> None:
        """A distractor is a snippet, so an image-only document supplies none."""
        docs = [
            DocumentPlan(doc_id="target", title="T", text_chunk_count=4),
            DocumentPlan(doc_id="pages", title="P", image_chunk_count=50),
        ]
        plan = sample_contexts(docs, count=1, type_mix=_MIX, seed=0)[0]
        picked = pick_distractor_positions(docs, plan, rng=random.Random(0), count=4)
        assert all(doc_id != "pages" for doc_id, _ in picked)
