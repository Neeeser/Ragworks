"""Seeded context planning for synthetic question generation.

A context plan names the chunk window one generation call reads: one chunk
for `single_fact`/`paraphrased` questions, a window of 2-3 adjacent chunks of
the same document for `multi_detail`. Sampling is chunk-pool based, so
documents are weighted by their size (a 40-chunk report earns more questions
than a 2-chunk note), with a per-document cap so one large document cannot
dominate the dataset. Everything is deterministic under a fixed seed.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from app.schemas.enums import EvalQuestionType

_MULTI_DETAIL_MAX_SPAN = 3
_RESAMPLE_ATTEMPTS = 12


@dataclass(frozen=True)
class DocumentPlan:
    """One source document eligible for generation: identity plus chunk count."""

    doc_id: str
    title: str
    chunk_count: int


@dataclass(frozen=True)
class ContextPlan:
    """One planned generation context: a chunk window plus its question type."""

    doc_id: str
    start_index: int
    span: int
    question_type: EvalQuestionType


class _ChunkPool:
    """A size-weighted draw space over documents' chunk positions."""

    def __init__(self, documents: list[DocumentPlan]) -> None:
        """Index the documents by cumulative chunk count."""
        self._bounds: list[tuple[int, DocumentPlan]] = []
        self.total = 0
        for doc in documents:
            self.total += doc.chunk_count
            self._bounds.append((self.total, doc))

    def draw(self, rng: random.Random) -> tuple[DocumentPlan, int]:
        """One uniform draw over pooled chunk positions."""
        value = rng.randrange(self.total)
        previous = 0
        for bound, doc in self._bounds:
            if value < bound:
                return doc, value - previous
            previous = bound
        last = self._bounds[-1][1]
        return last, last.chunk_count - 1

    def without_capped(self, per_doc: dict[str, int], cap: int) -> _ChunkPool | None:
        """The sub-pool of documents still under the cap; None when empty."""
        open_docs = [doc for _, doc in self._bounds if per_doc.get(doc.doc_id, 0) < cap]
        if not open_docs:
            return None
        return _ChunkPool(open_docs)


def per_document_cap(count: int, num_documents: int) -> int:
    """Contexts allowed per document: proportional share with slack, minimum 2."""
    if num_documents <= 0:
        return count
    return max(2, math.ceil(count / num_documents) * 2)


def sample_contexts(
    documents: list[DocumentPlan],
    *,
    count: int,
    type_mix: dict[EvalQuestionType, float],
    seed: int,
) -> list[ContextPlan]:
    """Plan `count` contexts across `documents`, seeded and size-weighted.

    Chunk positions are drawn from the pooled chunk space (size weighting for
    free), retried away from already-used windows and capped documents; when a
    small collection exhausts fresh positions the draw is accepted anyway —
    the downstream question dedup owns repeats, not the sampler.
    """
    eligible = [doc for doc in documents if doc.chunk_count > 0]
    if not eligible or count <= 0:
        return []
    rng = random.Random(seed)
    types = [qtype for qtype, weight in sorted(type_mix.items()) if weight > 0]
    weights = [type_mix[qtype] for qtype in types]
    pool = _ChunkPool(eligible)
    state = _SamplerState(cap=per_document_cap(count, len(eligible)))
    plans: list[ContextPlan] = []
    for _ in range(count):
        question_type = rng.choices(types, weights=weights)[0]
        plan = _draw_plan(rng, pool, question_type, state)
        state.used.add((plan.doc_id, plan.start_index))
        state.per_doc[plan.doc_id] = state.per_doc.get(plan.doc_id, 0) + 1
        plans.append(plan)
    return plans


def pick_distractor_positions(
    documents: list[DocumentPlan],
    plan: ContextPlan,
    *,
    rng: random.Random,
    count: int = 2,
) -> list[tuple[str, int]]:
    """Pick chunk positions from *other* documents to condition uniqueness on.

    Distractors show the generator what nearby corpus content looks like so it
    can phrase questions only the target context answers. A single-document
    collection yields none — the instruction simply drops out of the prompt.
    """
    others = [doc for doc in documents if doc.doc_id != plan.doc_id and doc.chunk_count > 0]
    positions: list[tuple[str, int]] = []
    for _ in range(count):
        if not others:
            break
        doc = rng.choice(others)
        positions.append((doc.doc_id, rng.randrange(doc.chunk_count)))
    return positions


@dataclass
class _SamplerState:
    """Mutable bookkeeping shared across draws: used windows and per-doc counts."""

    cap: int

    def __post_init__(self) -> None:
        """Start with no windows used and no documents counted."""
        self.used: set[tuple[str, int]] = set()
        self.per_doc: dict[str, int] = {}


def _draw_plan(
    rng: random.Random,
    pool: _ChunkPool,
    question_type: EvalQuestionType,
    state: _SamplerState,
) -> ContextPlan:
    """Draw one chunk window from an uncapped document, preferring fresh positions.

    Free draws are tried first; when a dominant document keeps winning the
    pooled draw past its cap, the redraw is constrained to the documents that
    still have capacity, so the cap holds whenever any other document can
    take the question.
    """
    plan = _random_plan(rng, pool, question_type)
    for _ in range(_RESAMPLE_ATTEMPTS):
        capped = state.per_doc.get(plan.doc_id, 0) >= state.cap
        if not capped and (plan.doc_id, plan.start_index) not in state.used:
            return plan
        plan = _random_plan(rng, pool, question_type)
    open_pool = pool.without_capped(state.per_doc, state.cap)
    if open_pool is None:
        return plan
    plan = _random_plan(rng, open_pool, question_type)
    for _ in range(_RESAMPLE_ATTEMPTS):
        if (plan.doc_id, plan.start_index) not in state.used:
            break
        plan = _random_plan(rng, open_pool, question_type)
    return plan


def _random_plan(
    rng: random.Random,
    pool: _ChunkPool,
    question_type: EvalQuestionType,
) -> ContextPlan:
    """One unconstrained draw from the pooled chunk space."""
    doc, index = pool.draw(rng)
    span = _span_for(rng, question_type, doc)
    start = min(index, doc.chunk_count - span)
    return ContextPlan(
        doc_id=doc.doc_id, start_index=start, span=span, question_type=question_type
    )


def _span_for(
    rng: random.Random, question_type: EvalQuestionType, doc: DocumentPlan
) -> int:
    """Window size for a question type, clamped to what the document has."""
    if question_type is not EvalQuestionType.MULTI_DETAIL:
        return 1
    return min(doc.chunk_count, rng.randint(2, _MULTI_DETAIL_MAX_SPAN))
