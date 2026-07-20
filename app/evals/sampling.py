"""Deterministic corpus sampling for an eval run.

Sampling is by query. The sampled corpus is every gold document for the sampled
queries (always included, so no query is made unanswerable) plus a random pool of
distractor documents that controls corpus scale and difficulty. A fixed seed makes
the whole plan reproducible, and the corpus hash content-addresses the sampled
corpus so an eval collection can be reused across retrieval pipelines that share
the same ingestion pipeline.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol


class JudgmentLike(Protocol):
    """The fields qrels grouping needs off a relevance-judgment row."""

    query_external_id: str
    doc_external_id: str
    relevance: int


def positive_qrels(judgments: Iterable[JudgmentLike]) -> dict[str, dict[str, int]]:
    """Group judgments by query, keeping only positive relevance grades.

    TREC/BEIR convention: a qrels row with relevance 0 means judged and
    explicitly NOT relevant (TREC-derived benchmarks ship such rows in volume).
    Counting those as gold inflates recall denominators, scores judged-irrelevant
    hits as relevant, and makes unanswerable queries look judged — so they are
    excluded here, at the single place qrels become gold.
    """
    qrels: dict[str, dict[str, int]] = {}
    for judgment in judgments:
        if judgment.relevance <= 0:
            continue
        grades = qrels.setdefault(judgment.query_external_id, {})
        grades[judgment.doc_external_id] = judgment.relevance
    return qrels


@dataclass(frozen=True)
class SamplePlan:
    """The resolved set of queries, gold docs, distractors, and corpus for a run."""

    query_ids: list[str]
    gold_doc_ids: list[str]
    distractor_doc_ids: list[str]
    corpus_doc_ids: list[str]


def build_sample_plan(
    *,
    query_ids: Sequence[str],
    qrels: Mapping[str, set[str]],
    corpus_doc_ids: Sequence[str],
    num_queries: int,
    distractor_pool_size: int,
    seed: int,
) -> SamplePlan:
    """Resolve the queries, gold docs, distractors, and corpus for one eval run.

    Inputs are sorted before sampling so the plan depends only on the content and
    the seed, not on iteration order. Gold documents absent from the corpus are
    dropped (they could never be retrieved), and only queries with at least one
    in-corpus judgment are sampled: BEIR archives ship every split's queries but
    only one split's qrels, and an unjudged (or unanswerable) query scores 0 on
    every metric, silently diluting the run's aggregates.
    """
    rng = random.Random(seed)
    corpus_set = set(corpus_doc_ids)
    judged = [
        query_id for query_id in query_ids if qrels.get(query_id, set()) & corpus_set
    ]
    sampled_queries = _sample_queries(rng, judged, num_queries)
    gold: set[str] = set()
    for query_id in sampled_queries:
        gold |= qrels.get(query_id, set()) & corpus_set
    distractors = _sample_distractors(rng, corpus_set, gold, distractor_pool_size)
    corpus = sorted(gold | set(distractors))
    return SamplePlan(
        query_ids=sampled_queries,
        gold_doc_ids=sorted(gold),
        distractor_doc_ids=distractors,
        corpus_doc_ids=corpus,
    )


def _sample_queries(
    rng: random.Random, query_ids: Sequence[str], num_queries: int
) -> list[str]:
    """Deterministically sample query ids, capped at the available count."""
    ordered = sorted(query_ids)
    return sorted(rng.sample(ordered, min(num_queries, len(ordered))))


def _sample_distractors(
    rng: random.Random,
    corpus_set: set[str],
    gold: set[str],
    distractor_pool_size: int,
) -> list[str]:
    """Deterministically sample non-gold docs, capped at what exists."""
    non_gold = sorted(corpus_set - gold)
    return sorted(rng.sample(non_gold, min(distractor_pool_size, len(non_gold))))
