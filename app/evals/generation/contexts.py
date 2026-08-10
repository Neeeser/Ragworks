"""Seeded context planning for synthetic question generation.

A context plan names what one generation call reads. A text plan names a
chunk window — one chunk for `single_fact`/`paraphrased` questions, a window
of 2-3 adjacent chunks of the same document for `multi_detail`. An image plan
names exactly one chunk: a page is the unit a model reads, and adjacent pages
carry no overlap to join across.

Sampling is a round-robin over documents in one seeded shuffled order: every
document is planned a window before any document is planned a second, and the
same rule repeats each pass until the requested count is met. A benchmark
whose questions concentrate on part of the corpus cannot say how retrieval
performs on the rest, which is what size weighting produced. Everything is
deterministic under a fixed seed.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from app.schemas.enums import EvalModality, EvalQuestionType
from app.schemas.media import InlineMedia

_MULTI_DETAIL_MAX_SPAN = 3
_RESAMPLE_ATTEMPTS = 12


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
    """Plan `count` contexts as a coverage-first rota over `documents`.

    Documents are shuffled once from the seed and then cycled: pass one plans
    a window in every document, pass two a second window in every document,
    and so on until `count` is met, so a quota smaller than the corpus still
    reaches that many distinct documents. Within a document the window is
    drawn at random and retried away from positions already planned; when a
    small document exhausts fresh positions the draw is accepted anyway — the
    downstream question dedup owns repeats, not the sampler.
    """
    eligible = [doc for doc in documents if doc.chunk_count > 0]
    if not eligible or count <= 0:
        return []
    rng = random.Random(seed)
    types = [qtype for qtype, weight in sorted(type_mix.items()) if weight > 0]
    weights = [type_mix[qtype] for qtype in types]
    rota = list(eligible)
    rng.shuffle(rota)
    used: set[tuple[str, EvalModality, int]] = set()
    plans: list[ContextPlan] = []
    while len(plans) < count:
        for doc in rota:
            if len(plans) >= count:
                break
            question_type = rng.choices(types, weights=weights)[0]
            plan = _draw_plan(rng, doc, question_type, used)
            used.add(_key(plan))
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


def _draw_plan(
    rng: random.Random,
    doc: DocumentPlan,
    question_type: EvalQuestionType,
    used: set[tuple[str, EvalModality, int]],
) -> ContextPlan:
    """Draw one window inside `doc`, preferring a position no plan holds yet."""
    plan = _random_plan(rng, doc, question_type)
    for _ in range(_RESAMPLE_ATTEMPTS):
        if _key(plan) not in used:
            break
        plan = _random_plan(rng, doc, question_type)
    return plan


def _key(plan: ContextPlan) -> tuple[str, EvalModality, int]:
    """The identity of a drawn window: a position is per modality."""
    return (plan.doc_id, plan.modality, plan.start_index)


def _random_plan(
    rng: random.Random,
    doc: DocumentPlan,
    question_type: EvalQuestionType,
) -> ContextPlan:
    """One unconstrained window inside one document."""
    modality = _draw_modality(rng, doc)
    span = _span_for(rng, question_type, doc, modality)
    start = rng.randrange(doc.count_for(modality) - span + 1)
    return ContextPlan(
        doc_id=doc.doc_id,
        start_index=start,
        span=span,
        question_type=question_type,
        modality=modality,
    )


def _draw_modality(rng: random.Random, doc: DocumentPlan) -> EvalModality:
    """Which modality this window reads, weighted by the document's own chunks.

    A mixed PDF is asked about its pages roughly as often as its text carries
    chunks; a document holding one modality only ever plans that one, so the
    rota never routes a window at a model the corpus has nothing for.
    """
    images = doc.image_chunk_count
    if images <= 0:
        return EvalModality.TEXT
    if doc.text_chunk_count <= 0:
        return EvalModality.IMAGE
    drawn = rng.randrange(doc.chunk_count)
    return EvalModality.IMAGE if drawn < images else EvalModality.TEXT


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
