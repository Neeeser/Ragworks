"""The v1 retrieval metric family, defined once with hand-checkable formulas.

Every function scores an ordered, document-level-deduplicated result list against
the query's gold documents at cutoff `k`. `gold` maps each relevant document id
to its positive relevance grade: binary metrics use membership, nDCG uses the
grade as its gain. `k` is an evaluation-side truncation point: `retrieved[:k]`
uses whatever the pipeline returned, so a pipeline that returned fewer than `k`
results (or used a score threshold) needs no special handling.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence

from app.evals.metrics.base import Metric


def recall_at_k(retrieved: Sequence[str], gold: Mapping[str, int], k: int) -> float:
    """Fraction of gold documents that appear in the top-k."""
    if not gold:
        return 0.0
    hits = sum(1 for doc_id in retrieved[:k] if doc_id in gold)
    return hits / len(gold)


def precision_at_k(retrieved: Sequence[str], gold: Mapping[str, int], k: int) -> float:
    """Fraction of the top-k that is relevant, always divided by k.

    trec_eval convention: returning fewer than k results does not shrink the
    denominator — otherwise a pipeline returning 3 results is scored over 3
    while a competitor returning k is scored over k, and the numbers are not
    comparable across pipelines.
    """
    if k <= 0 or not gold:
        return 0.0
    hits = sum(1 for doc_id in retrieved[:k] if doc_id in gold)
    return hits / k


def hit_at_k(retrieved: Sequence[str], gold: Mapping[str, int], k: int) -> float:
    """1.0 when any gold document is in the top-k, else 0.0."""
    if not gold:
        return 0.0
    return 1.0 if any(doc_id in gold for doc_id in retrieved[:k]) else 0.0


def mrr_at_k(retrieved: Sequence[str], gold: Mapping[str, int], k: int) -> float:
    """Reciprocal rank of the first gold document within the top-k."""
    if not gold:
        return 0.0
    for rank, doc_id in enumerate(retrieved[:k], start=1):
        if doc_id in gold:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(retrieved: Sequence[str], gold: Mapping[str, int], k: int) -> float:
    """Normalized discounted cumulative gain at k with graded relevance.

    Gain is the qrels grade itself (the trec_eval/pytrec_eval convention), so a
    binary dataset (every grade 1) reduces to the familiar binary nDCG and a
    graded dataset matches published BEIR-style baselines.
    """
    if not gold:
        return 0.0
    dcg = sum(
        gold.get(doc_id, 0) / math.log2(rank + 1)
        for rank, doc_id in enumerate(retrieved[:k], start=1)
    )
    ideal_grades = sorted(gold.values(), reverse=True)[:k]
    idcg = sum(
        grade / math.log2(rank + 1) for rank, grade in enumerate(ideal_grades, start=1)
    )
    if idcg == 0.0:
        return 0.0
    return dcg / idcg


def map_at_k(retrieved: Sequence[str], gold: Mapping[str, int], k: int) -> float:
    """Average precision at k, normalized the trec_eval/pytrec_eval way.

    Sum the precision at each gold hit within the top-k, then divide by the
    total number of relevant documents for the query (not `min(len(gold), k)`).
    This is exactly trec_eval's `map_cut`, which BEIR reports against: a query
    with more relevant documents than the cutoff is correctly penalized for the
    relevant documents it could not fit into the top-k. Dividing by
    `min(len(gold), k)` would overstate MAP whenever a query has more gold
    documents than `k`.
    """
    if not gold:
        return 0.0
    hits = 0
    precision_sum = 0.0
    for rank, doc_id in enumerate(retrieved[:k], start=1):
        if doc_id in gold:
            hits += 1
            precision_sum += hits / rank
    return precision_sum / len(gold)


RETRIEVAL_METRICS: tuple[Metric, ...] = (
    Metric(
        name="recall",
        label="Recall@k",
        description=(
            "Of all documents relevant to the query, the fraction that appear in the "
            "top-k retrieved results. The primary RAG retrieval metric: a document that "
            "is never retrieved can never be used to answer."
        ),
        is_rank_aware=False,
        compute=recall_at_k,
    ),
    Metric(
        name="precision",
        label="Precision@k",
        description=(
            "Of the top-k retrieved results, the fraction that are relevant. High "
            "precision means little irrelevant context is passed downstream."
        ),
        is_rank_aware=False,
        compute=precision_at_k,
    ),
    Metric(
        name="hit",
        label="Hit@k",
        description=(
            "1 if at least one relevant document is in the top-k, otherwise 0. Also "
            "called Accuracy@k — did retrieval surface anything useful at all?"
        ),
        is_rank_aware=False,
        compute=hit_at_k,
    ),
    Metric(
        name="mrr",
        label="MRR@k",
        description=(
            "Mean reciprocal rank: the inverse of the position of the first relevant "
            "result within the top-k. Rewards ranking relevant documents higher — a "
            "measure of reranking quality."
        ),
        is_rank_aware=True,
        compute=mrr_at_k,
    ),
    Metric(
        name="ndcg",
        label="nDCG@k",
        description=(
            "Normalized discounted cumulative gain: relevance weighted by position and "
            "normalized against the ideal ordering. The standard rank-aware quality "
            "metric — later relevant hits count for less."
        ),
        is_rank_aware=True,
        compute=ndcg_at_k,
    ),
    Metric(
        name="map",
        label="MAP@k",
        description=(
            "Mean average precision: the average of the precision values measured at "
            "each relevant hit in the top-k. Rewards retrieving relevant documents both "
            "completely and early."
        ),
        is_rank_aware=True,
        compute=map_at_k,
    ),
)
