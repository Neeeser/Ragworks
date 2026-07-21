"""Background orchestration for synthetic dataset generation.

`run_dataset_generation` mirrors `run_dataset_download`: it owns its session,
never re-raises past logging, and the persisted dataset row is the outcome.
Per context window it makes one generation call and (when candidates survive
the mechanical gates) one critique call through the user's chat provider,
committing progress after every window so the UI can poll it live. Deleting
the dataset row is the cancellation signal — the loop notices on its next
progress commit and stops quietly.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session, col, select

from app.db import models
from app.db.engine import session_scope
from app.evals.generation.candidates import (
    CandidateQuestion,
    CritiqueScores,
    is_duplicate_question,
    parse_candidates,
    parse_critiques,
    quote_matches,
)
from app.evals.generation.contexts import ContextPlan, DocumentPlan, sample_contexts
from app.evals.generation.corpus import join_chunks
from app.evals.generation.persistence import (
    AcceptedQuestion,
    persist_generated_dataset,
    record_generation_outcome,
)
from app.evals.generation.prompts import (
    build_critique_messages,
    build_generation_messages,
)
from app.evals.generation.sources import (
    distractor_texts,
    eligible_documents,
    load_chunks,
)
from app.providers.chat.base import ChatProvider, ChatRequest
from app.providers.registry import get_provider, resolve_connection
from app.schemas.enums import EvalDatasetStatus, ProviderKind
from app.schemas.evals_generation import EvalDatasetGenerateRequest
from app.services.errors import InvalidInputError

logger = logging.getLogger(__name__)

CANDIDATES_PER_CONTEXT = 3
CRITIQUE_MINIMUM = 4
CONTEXT_OVERSAMPLE = 2
MAX_CONSECUTIVE_CALL_FAILURES = 3
GENERATION_TEMPERATURE = 0.7
CRITIQUE_TEMPERATURE = 0.0


def run_dataset_generation(dataset_id: UUID) -> None:
    """Background-task entry point: generate one synthetic dataset, never raise."""
    with session_scope() as session:
        dataset = session.get(models.EvalDataset, dataset_id)
        if dataset is None or dataset.status != EvalDatasetStatus.GENERATING.value:
            return
        started = time.monotonic()
        try:
            stats = _generate(session, dataset)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # Deliberately broad: the FAILED dataset row is the outcome a
            # background task records; there is no caller left to re-raise to.
            logger.exception("Synthetic generation failed for dataset %s", dataset_id)
            session.rollback()
            dataset = session.get(models.EvalDataset, dataset_id)
            if dataset is None:  # deleted mid-run: cancellation, nothing to record
                return
            dataset.status = EvalDatasetStatus.FAILED.value
            dataset.error_message = str(exc) or exc.__class__.__name__
            session.add(dataset)
            session.commit()
            stats = None
        if stats is None:
            record_generation_outcome(session, dataset_id, started, generated=0, accepted=0)
            return
        generated, accepted = stats
        record_generation_outcome(
            session, dataset_id, started, generated=generated, accepted=accepted
        )


@dataclass(frozen=True)
class _RunSetup:
    """Everything the generation loop reads: config, corpus, and the provider."""

    config: EvalDatasetGenerateRequest
    documents: list[models.Document]
    doc_plans: list[DocumentPlan]
    chunk_map: dict[str, list[models.DocumentChunkRecord]]
    chat: ChatProvider


@dataclass
class _LoopState:
    """Mutable accumulator for the generation loop."""

    limit: int

    def __post_init__(self) -> None:
        """Start empty: nothing accepted, nothing generated, no failures."""
        self.accepted: list[AcceptedQuestion] = []
        self.accepted_texts: list[str] = []
        self.generated = 0
        self.consecutive_failures = 0

    @property
    def done(self) -> bool:
        """True once the acceptance target is reached."""
        return len(self.accepted) >= self.limit


def _generate(session: Session, dataset: models.EvalDataset) -> tuple[int, int] | None:
    """Run the generate→filter loop; return (generated, accepted) counts.

    Returns None when the dataset row disappears mid-run (delete-as-cancel).
    Raises on unusable configuration or a persistently failing provider; the
    caller records the FAILED row.
    """
    setup = _prepare(session, dataset)
    config = setup.config
    plans = sample_contexts(
        setup.doc_plans,
        count=config.num_questions * CONTEXT_OVERSAMPLE,
        type_mix=config.type_mix,
        seed=config.seed,
    )
    state = _LoopState(limit=config.num_questions)
    distractor_rng = random.Random(config.seed + 1)
    for plan in plans:
        if state.done:
            break
        _run_plan(setup, plan, distractor_rng, state, dataset.id)
        refreshed = _commit_progress(session, dataset.id, len(state.accepted))
        if refreshed is None:
            logger.info("Synthetic generation cancelled by dataset deletion.")
            return None
        dataset = refreshed
    if not state.accepted:
        raise InvalidInputError(
            "No generated questions passed the quality filters. Try a different"
            " model or a collection with more substantial text."
        )
    persist_generated_dataset(
        session,
        dataset,
        documents=setup.documents,
        chunk_map=setup.chunk_map,
        accepted=state.accepted,
        generated_count=state.generated,
    )
    return state.generated, len(state.accepted)


def _prepare(session: Session, dataset: models.EvalDataset) -> _RunSetup:
    """Validate the stored request and load everything the loop needs."""
    config = EvalDatasetGenerateRequest.model_validate(dataset.generation_config or {})
    user = session.get(models.User, dataset.user_id)
    if user is None:
        raise InvalidInputError("The dataset's owning user no longer exists.")
    documents = eligible_documents(session, config.collection_id)
    if not documents:
        raise InvalidInputError(
            "The collection has no ingested documents with stored chunks."
        )
    connection = resolve_connection(session, user, config.connection_id)
    chat = get_provider(connection, ProviderKind.CHAT).chat_provider()
    doc_plans = [
        DocumentPlan(doc_id=str(doc.id), title=doc.name, chunk_count=doc.num_chunks)
        for doc in documents
    ]
    return _RunSetup(
        config=config,
        documents=documents,
        doc_plans=doc_plans,
        chunk_map=load_chunks(session, documents),
        chat=chat,
    )


def _run_plan(
    setup: _RunSetup,
    plan: ContextPlan,
    rng: random.Random,
    state: _LoopState,
    dataset_id: UUID,
) -> None:
    """Generate and filter one context window's candidates into the state.

    A failed provider call is tolerated up to `MAX_CONSECUTIVE_CALL_FAILURES`
    in a row (then re-raised — a wrong key or dead endpoint should fail the
    dataset quickly, not burn through every context).
    """
    context_chunks = setup.chunk_map.get(plan.doc_id, [])[
        plan.start_index : plan.start_index + plan.span
    ]
    if not context_chunks:
        return
    context_text = join_chunks([chunk.text for chunk in context_chunks])
    try:
        batch = _generate_for_context(
            setup.chat,
            setup.config,
            context_text=context_text,
            plan=plan,
            distractor_texts=distractor_texts(setup.doc_plans, plan, setup.chunk_map, rng),
            accepted_texts=state.accepted_texts,
        )
        state.consecutive_failures = 0
    except Exception:
        state.consecutive_failures += 1
        if state.consecutive_failures >= MAX_CONSECUTIVE_CALL_FAILURES:
            raise
        logger.warning(
            "Generation call failed for dataset %s; skipping context",
            dataset_id,
            exc_info=True,
        )
        return
    state.generated += batch.generated
    chunk_ids = [str(chunk.id) for chunk in context_chunks]
    for candidate, scores in batch.kept:
        if state.done:
            break
        state.accepted.append(
            AcceptedQuestion(
                question=candidate.question,
                answer=candidate.answer,
                quote=candidate.quote,
                scores=scores,
                doc_id=plan.doc_id,
                chunk_ids=chunk_ids,
                question_type=plan.question_type.value,
            )
        )
        state.accepted_texts.append(candidate.question)


@dataclass(frozen=True)
class _ContextBatch:
    """One context's surviving candidates with their scores."""

    generated: int
    kept: list[tuple[CandidateQuestion, CritiqueScores]]


def _generate_for_context(
    chat: ChatProvider,
    config: EvalDatasetGenerateRequest,
    *,
    context_text: str,
    plan: ContextPlan,
    distractor_texts: list[str],
    accepted_texts: list[str],
) -> _ContextBatch:
    """One generation call plus (when needed) one critique call for a context."""
    reply = _chat_text(
        chat,
        config.model_name,
        build_generation_messages(
            context_text=context_text,
            question_type=plan.question_type,
            candidates_per_context=CANDIDATES_PER_CONTEXT,
            audience=config.audience,
            example_queries=config.example_queries,
            distractor_texts=distractor_texts,
        ),
        temperature=GENERATION_TEMPERATURE,
    )
    candidates = parse_candidates(reply)
    generated = len(candidates)
    candidates = [
        candidate
        for candidate in candidates
        if quote_matches(candidate.quote, context_text)
        and not is_duplicate_question(candidate.question, accepted_texts)
    ]
    if not candidates:
        return _ContextBatch(generated=generated, kept=[])
    critique_reply = _chat_text(
        chat,
        config.model_name,
        build_critique_messages(context_text=context_text, candidates=candidates),
        temperature=CRITIQUE_TEMPERATURE,
    )
    scores = parse_critiques(critique_reply, len(candidates))
    if scores is None:
        return _ContextBatch(generated=generated, kept=[])
    kept: list[tuple[CandidateQuestion, CritiqueScores]] = []
    batch_texts: list[str] = []
    for candidate, score in zip(candidates, scores, strict=True):
        if not score.passes(CRITIQUE_MINIMUM):
            continue
        if is_duplicate_question(candidate.question, batch_texts):
            continue
        kept.append((candidate, score))
        batch_texts.append(candidate.question)
    return _ContextBatch(generated=generated, kept=kept)


def _chat_text(
    chat: ChatProvider,
    model: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
) -> str:
    """One non-streaming chat call, reduced to its text content."""
    request = ChatRequest(
        messages=[dict(message) for message in messages],
        tools=None,
        model=model,
        parameters={"temperature": temperature},
    )
    parsed = chat.parse_chat_response(chat.chat(request))
    content = parsed.message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict)
        )
    return ""


def _commit_progress(
    session: Session, dataset_id: UUID, accepted: int
) -> models.EvalDataset | None:
    """Persist progress and return the fresh row; None means cancelled.

    Both reads are explicit SELECTs (never identity-map hits), so a dataset
    row deleted from another session — the cancellation signal — is observed
    as None instead of a stale cached instance.
    """
    dataset = _select_dataset(session, dataset_id)
    if dataset is None:
        return None
    dataset.progress_done = accepted
    session.add(dataset)
    session.commit()
    dataset = _select_dataset(session, dataset_id)
    if dataset is None or dataset.status != EvalDatasetStatus.GENERATING.value:
        return None
    return dataset


def _select_dataset(session: Session, dataset_id: UUID) -> models.EvalDataset | None:
    """Read the dataset row straight from the database."""
    statement = select(models.EvalDataset).where(col(models.EvalDataset.id) == dataset_id)
    return session.exec(statement).first()
