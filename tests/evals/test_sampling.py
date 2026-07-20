"""Behavior tests for eval-run corpus sampling.

The load-bearing invariant: every gold document for a sampled query is always in
the sampled corpus (so no sampled query is made unanswerable), and sampling is
deterministic under a fixed seed (so runs are reproducible and comparable).
"""

from __future__ import annotations

from uuid import uuid4

from app.db import models
from app.evals.sampling import build_sample_plan, positive_qrels

QUERIES = ["q1", "q2", "q3", "q4"]
QRELS = {
    "q1": {"d1", "d2"},
    "q2": {"d2", "d3"},
    "q3": {"d4"},
    "q4": {"d99"},  # gold doc missing from the corpus
}
CORPUS = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"]


def _plan(num_queries: int = 4, distractors: int = 2, seed: int = 0):
    return build_sample_plan(
        query_ids=QUERIES,
        qrels=QRELS,
        corpus_doc_ids=CORPUS,
        num_queries=num_queries,
        distractor_pool_size=distractors,
        seed=seed,
    )


def test_sampling_is_deterministic_under_a_fixed_seed() -> None:
    """Two builds with the same inputs and seed are identical."""
    assert _plan(num_queries=2, seed=7) == _plan(num_queries=2, seed=7)


def test_unjudged_queries_are_never_sampled() -> None:
    """Only queries with an in-corpus relevance judgment are sampled.

    BEIR archives ship every split's queries but only one split's qrels
    (SciFact: 1,109 queries, 300 judged) — an unjudged query scores 0 on every
    metric and silently dilutes the run's aggregates. The same goes for a
    judged query whose every gold doc is missing from the corpus: it can never
    be answered.
    """
    plan = build_sample_plan(
        query_ids=[*QUERIES, "q-unjudged"],
        qrels=QRELS,
        corpus_doc_ids=CORPUS,
        num_queries=99,
        distractor_pool_size=0,
        seed=0,
    )
    assert set(plan.query_ids) == {"q1", "q2", "q3"}


def test_gold_docs_are_always_in_the_corpus() -> None:
    """Every gold doc for a sampled query appears in the sampled corpus."""
    plan = _plan(num_queries=2, distractors=1, seed=3)
    corpus = set(plan.corpus_doc_ids)
    for query_id in plan.query_ids:
        for gold_doc in QRELS[query_id] & set(CORPUS):
            assert gold_doc in corpus


def test_gold_docs_missing_from_corpus_are_excluded() -> None:
    """A qrel pointing at a doc not in the corpus never enters the gold set."""
    plan = _plan(num_queries=4)  # includes q4, whose only gold doc is d99
    assert "d99" not in plan.gold_doc_ids
    assert plan.gold_doc_ids == ["d1", "d2", "d3", "d4"]


def test_distractors_exclude_gold_and_respect_the_pool_size() -> None:
    """Distractors are drawn only from non-gold docs, capped at the pool size."""
    plan = _plan(num_queries=4, distractors=2)
    gold = set(plan.gold_doc_ids)
    assert len(plan.distractor_doc_ids) == 2
    assert all(doc_id not in gold for doc_id in plan.distractor_doc_ids)


def test_distractor_pool_is_capped_at_available_non_gold_docs() -> None:
    """Asking for more distractors than exist yields every non-gold doc."""
    plan = _plan(num_queries=4, distractors=100)
    assert set(plan.distractor_doc_ids) == {"d5", "d6", "d7"}


def test_query_count_is_capped_at_available_queries() -> None:
    """Asking for more queries than exist samples every judged one.

    q4's only gold doc is missing from the corpus, so it is unanswerable and
    excluded from the sampling pool along with unjudged queries.
    """
    plan = _plan(num_queries=99)
    assert plan.query_ids == ["q1", "q2", "q3"]


def test_corpus_is_the_union_of_gold_and_distractors() -> None:
    """The sampled corpus is exactly gold plus distractors, deduplicated."""
    plan = _plan(num_queries=4, distractors=2)
    assert set(plan.corpus_doc_ids) == set(plan.gold_doc_ids) | set(plan.distractor_doc_ids)


def test_positive_qrels_excludes_judged_not_relevant_rows() -> None:
    """Relevance 0 means judged NOT relevant (TREC/BEIR); it never becomes gold.

    TREC-derived benchmarks ship explicit 0-score qrels rows in volume; counting
    them as gold inflates recall denominators and scores judged-irrelevant hits
    as relevant.
    """
    judgments = [
        models.EvalRelevanceJudgment(
            dataset_id=uuid4(), query_external_id=query, doc_external_id=doc, relevance=grade
        )
        for query, doc, grade in [
            ("q1", "d1", 2),
            ("q1", "d2", 0),
            ("q1", "d3", 1),
            ("q2", "d1", 0),
        ]
    ]
    assert positive_qrels(judgments) == {"q1": {"d1": 2, "d3": 1}}


def test_positive_qrels_excludes_negative_grades() -> None:
    """A negative relevance grade is non-positive and never becomes gold."""
    judgments = [
        models.EvalRelevanceJudgment(
            dataset_id=uuid4(), query_external_id="q1", doc_external_id="d1", relevance=-1
        )
    ]
    assert positive_qrels(judgments) == {}


def test_positive_qrels_last_grade_wins_for_a_duplicate_pair() -> None:
    """A repeated (query, doc) pair keeps the last grade, not a sum or the first.

    Malformed uploads can repeat a judgment row; grouping into a dict means the
    last row wins, so gold membership stays a single grade per document rather
    than accumulating.
    """
    dataset_id = uuid4()
    judgments = [
        models.EvalRelevanceJudgment(
            dataset_id=dataset_id, query_external_id="q1", doc_external_id="d1", relevance=1
        ),
        models.EvalRelevanceJudgment(
            dataset_id=dataset_id, query_external_id="q1", doc_external_id="d1", relevance=3
        ),
    ]
    assert positive_qrels(judgments) == {"q1": {"d1": 3}}
