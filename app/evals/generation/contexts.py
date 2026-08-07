"""Seeded context planning for synthetic question generation.

A context plan names what one generation call reads. A text plan names a
chunk window — one chunk for `single_fact`/`paraphrased` questions, a window
of 2-3 adjacent chunks of the same document for `multi_detail`. An image plan
names exactly one chunk: a page is the unit a model reads, and adjacent pages
carry no overlap to join across.

Sampling is chunk-pool based and spans both modalities, so documents are
weighted by their size (a 40-chunk report earns more questions than a 2-chunk
note) with a per-document cap so one large document cannot dominate the
dataset. Everything is deterministic under a fixed seed.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from app.schemas.enums import EvalModality, EvalQuestionType
from app.schemas.media import InlineMedia

_MULTI_DETAIL_MAX_SPAN = 3
_RESAMPLE_ATTEMPTS = 12
_MODALITIES = (EvalModality.TEXT, EvalModality.IMAGE)


@dataclass(frozen=True)
class DocumentPlan:
    """One source document eligible for generation: identity plus chunk counts.

    The counts are per modality because a chunk is only sampleable by the
    model that reads it, and a mixed PDF contributes to both pools.
    """

    doc_id: str
    title: str
    text_chunk_count: int = 0
    image_chunk_count: int = 0

    @property
    def chunk_count(self) -> int:
        """Every sampleable chunk the document holds, across modalities."""
        return self.text_chunk_count + self.image_chunk_count

    def count_for(self, modality: EvalModality) -> int:
        """How many chunks the document holds in one modality."""
        return self.image_chunk_count if modality is EvalModality.IMAGE else self.text_chunk_count


@dataclass(frozen=True)
class ContextPlan:
    """One planned generation context: a chunk window, its type, its modality.

    `start_index` indexes the document's chunks *of that modality*, not its
    whole chunk list, so a plan survives a document whose pages and text
    interleave.
    """

    doc_id: str
    start_index: int
    span: int
    question_type: EvalQuestionType
    modality: EvalModality = EvalModality.TEXT


@dataclass(frozen=True)
class TextContext:
    """The joined chunk text one text generation call reads."""

    text: str


@dataclass(frozen=True)
class ImageContext:
    """The single page image one image generation call reads."""

    image: InlineMedia


#: What a planned window resolves to once its chunks are loaded. The two
#: arms take different prompts, different response schemas, and different
#: acceptance gates, which is why they are separate types rather than one
#: record with two optional fields.
GenerationContext = TextContext | ImageContext


@dataclass(frozen=True)
class _Segment:
    """One document's draw space in one modality."""

    doc: DocumentPlan
    modality: EvalModality
    size: int


class _ChunkPool:
    """A size-weighted draw space over documents' chunk positions.

    Positions span both modalities, so a page-image document is drawn as
    often as a text document holding the same number of chunks.
    """

    def __init__(self, documents: list[DocumentPlan]) -> None:
        """Index the documents' per-modality segments by cumulative size."""
        self._bounds: list[tuple[int, _Segment]] = []
        self.total = 0
        for doc in documents:
            for modality in _MODALITIES:
                size = doc.count_for(modality)
                if size <= 0:
                    continue
                self.total += size
                self._bounds.append((self.total, _Segment(doc, modality, size)))

    def draw(self, rng: random.Random) -> tuple[DocumentPlan, EvalModality, int]:
        """One uniform draw over pooled chunk positions."""
        value = rng.randrange(self.total)
        previous = 0
        for bound, segment in self._bounds:
            if value < bound:
                return segment.doc, segment.modality, value - previous
            previous = bound
        last = self._bounds[-1][1]
        return last.doc, last.modality, last.size - 1

    def without_capped(self, per_doc: dict[str, int], cap: int) -> _ChunkPool | None:
        """The sub-pool of documents still under the cap; None when empty."""
        open_docs: list[DocumentPlan] = []
        seen: set[str] = set()
        for _, segment in self._bounds:
            if segment.doc.doc_id in seen:
                continue
            seen.add(segment.doc.doc_id)
            if per_doc.get(segment.doc.doc_id, 0) < cap:
                open_docs.append(segment.doc)
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

    Chunk positions are drawn from the pooled chunk space (size weighting and
    modality weighting for free), retried away from already-used windows and
    capped documents; when a small collection exhausts fresh positions the
    draw is accepted anyway — the downstream question dedup owns repeats, not
    the sampler.
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
        state.used.add((plan.doc_id, plan.modality, plan.start_index))
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
    """Pick text chunk positions from *other* documents to condition on.

    Distractors show the generator what nearby corpus content looks like so it
    can phrase questions only the target context answers. A single-document
    collection yields none — the instruction simply drops out of the prompt.
    """
    others = [doc for doc in documents if doc.doc_id != plan.doc_id and doc.text_chunk_count > 0]
    positions: list[tuple[str, int]] = []
    for _ in range(count):
        if not others:
            break
        doc = rng.choice(others)
        positions.append((doc.doc_id, rng.randrange(doc.text_chunk_count)))
    return positions


@dataclass
class _SamplerState:
    """Mutable bookkeeping shared across draws: used windows and per-doc counts."""

    cap: int

    def __post_init__(self) -> None:
        """Start with no windows used and no documents counted."""
        self.used: set[tuple[str, EvalModality, int]] = set()
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
    take the question. The cap spans both modalities: it bounds a document's
    share of the dataset, not its share of one modality.
    """
    plan = _random_plan(rng, pool, question_type)
    for _ in range(_RESAMPLE_ATTEMPTS):
        capped = state.per_doc.get(plan.doc_id, 0) >= state.cap
        if not capped and _key(plan) not in state.used:
            return plan
        plan = _random_plan(rng, pool, question_type)
    open_pool = pool.without_capped(state.per_doc, state.cap)
    if open_pool is None:
        return plan
    plan = _random_plan(rng, open_pool, question_type)
    for _ in range(_RESAMPLE_ATTEMPTS):
        if _key(plan) not in state.used:
            break
        plan = _random_plan(rng, open_pool, question_type)
    return plan


def _key(plan: ContextPlan) -> tuple[str, EvalModality, int]:
    """The identity of a drawn window: a position is per modality."""
    return (plan.doc_id, plan.modality, plan.start_index)


def _random_plan(
    rng: random.Random,
    pool: _ChunkPool,
    question_type: EvalQuestionType,
) -> ContextPlan:
    """One unconstrained draw from the pooled chunk space."""
    doc, modality, index = pool.draw(rng)
    span = _span_for(rng, question_type, doc, modality)
    start = min(index, doc.count_for(modality) - span)
    return ContextPlan(
        doc_id=doc.doc_id,
        start_index=start,
        span=span,
        question_type=question_type,
        modality=modality,
    )


def _span_for(
    rng: random.Random,
    question_type: EvalQuestionType,
    doc: DocumentPlan,
    modality: EvalModality,
) -> int:
    """Window size for a question type, clamped to what the document has.

    An image window is always one chunk regardless of question type: a page
    is what the model is shown, and a multi-detail question about a page
    combines details *within* it.
    """
    if modality is EvalModality.IMAGE:
        return 1
    if question_type is not EvalQuestionType.MULTI_DETAIL:
        return 1
    return min(doc.text_chunk_count, rng.randint(2, _MULTI_DETAIL_MAX_SPAN))
