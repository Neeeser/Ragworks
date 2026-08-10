"""Background orchestration for synthetic dataset generation.

`run_dataset_generation` mirrors `run_dataset_download`: it owns its session,
never re-raises past logging, and the persisted dataset row is the outcome.
Per context window it makes one generation call and (when candidates survive
the mechanical gates) one critique call through the model configured for that
window's modality, committing progress after every window so the UI can poll
it live. Deleting the dataset row is the cancellation signal — the loop
notices on its next progress commit and stops quietly.
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
from app.evals.datasets.media import DatasetMediaStore
from app.evals.generation.calls import ModalityChat, generate_for_context
from app.evals.generation.contexts import (
    ContextPlan,
    DocumentPlan,
    per_document_cap,
    sample_contexts,
)
from app.evals.generation.persistence import (
    AcceptedQuestion,
    persist_generated_dataset,
    record_generation_outcome,
)
from app.evals.generation.sources import (
    DocumentChunks,
    SourceCollection,
    distractor_texts,
    eligible_documents,
    load_chunks,
    load_context,
)
from app.providers.pricing import catalog_pricing
from app.providers.registry import get_provider, resolve_connection
from app.providers.throttled import throttled_chat
from app.providers.usage_context import usage_scope
from app.schemas.enums import EvalDatasetStatus, EvalModality, ProviderKind, UsageSurface
from app.schemas.evals_generation import EvalDatasetGenerateRequest
from app.schemas.evals_usage import EvalUsage
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)

#: Windows planned per requested question. Acceptance is coverage-first, so a
#: window contributes one question and the spare windows are what a context
#: that yields nothing is filled in from. Unused plans cost nothing — the loop
#: stops at the quota.
CONTEXT_OVERSAMPLE = 3
MAX_CONSECUTIVE_CALL_FAILURES = 3


def run_dataset_generation(dataset_id: UUID) -> None:
    """Background-task entry point: generate one synthetic dataset, never raise."""
    with session_scope() as session:
        dataset = session.get(models.EvalDataset, dataset_id)
        if dataset is None or dataset.status != EvalDatasetStatus.GENERATING.value:
            return
        started = time.monotonic()
        try:
            stats = _generate(session, dataset)
        except Exception as exc:
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
    """Everything the generation loop reads: config, corpus, and the providers."""

    config: EvalDatasetGenerateRequest
    source: SourceCollection
    doc_plans: list[DocumentPlan]
    chats: dict[EvalModality, ModalityChat]


@dataclass
class _LoopState:
    """Mutable accumulator for the generation loop.

    Acceptance is coverage-first, and the rule that makes it so lives in
    `_run_plan`: one context window contributes at most one question. Paired
    with the sampler's rota — every document planned a window before any
    document gets a second — a document cannot hold two questions until every
    other document has been offered its first. Without it, one window's
    surplus candidates (up to `CANDIDATES_PER_CONTEXT`) fill the target before
    most of the collection is ever asked about, and the dataset cannot say how
    retrieval performs on the documents it never covered.

    `doc_cap` stays as the long-run backstop for a corpus where most windows
    yield nothing and one document keeps earning turns.
    """

    limit: int
    doc_cap: int

    def __post_init__(self) -> None:
        """Start empty: nothing accepted, nothing generated, no failures."""
        self.accepted: list[AcceptedQuestion] = []
        self.accepted_texts: list[str] = []
        self.per_doc_accepted: dict[str, int] = {}
        self.generated = 0
        self.consecutive_failures = 0
        self.usage = EvalUsage()

    @property
    def done(self) -> bool:
        """True once the acceptance target is reached."""
        return len(self.accepted) >= self.limit

    def doc_capped(self, doc_id: str) -> bool:
        """True when a document has already contributed its share of questions."""
        return self.per_doc_accepted.get(doc_id, 0) >= self.doc_cap


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
    state = _LoopState(
        limit=config.num_questions,
        doc_cap=per_document_cap(config.num_questions, len(setup.doc_plans)),
    )
    distractor_rng = random.Random(config.seed + 1)
    for plan in plans:
        if state.done:
            break
        with usage_scope(
            dataset.user_id,
            UsageSurface.EVAL_GENERATION,
            context_type="eval_dataset",
            context_id=dataset.id,
        ):
            _run_plan(setup, plan, distractor_rng, state, dataset.id)
        refreshed = _commit_progress(session, dataset.id, len(state.accepted), state.usage)
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
        source=setup.source,
        accepted=state.accepted,
        generated_count=state.generated,
        media=DatasetMediaStore(setup.source.storage, dataset.id),
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
        raise InvalidInputError("The collection has no ingested documents with stored chunks.")
    source = SourceCollection(
        documents=documents,
        chunks=load_chunks(session, documents),
        storage=FileStorage(),
    )
    doc_plans = [_document_plan(doc, source.chunks_of(str(doc.id))) for doc in documents]
    return _RunSetup(
        config=config,
        source=source,
        doc_plans=doc_plans,
        chats=_resolve_chats(session, user, config, doc_plans),
    )


def _document_plan(doc: models.Document, chunks: DocumentChunks) -> DocumentPlan:
    """One document's sampling weight, counted from the chunks it actually stored.

    Counting the loaded rows rather than `Document.num_chunks` keeps the
    sampler from planning windows a re-ingest has since emptied.
    """
    return DocumentPlan(
        doc_id=str(doc.id),
        title=doc.name,
        text_chunk_count=len(chunks.text),
        image_chunk_count=len(chunks.images),
    )


def _resolve_chats(
    session: Session,
    user: models.User,
    config: EvalDatasetGenerateRequest,
    doc_plans: list[DocumentPlan],
) -> dict[EvalModality, ModalityChat]:
    """One throttled chat provider per modality the corpus actually holds.

    Each is throttled against its own connection id, so two modalities served
    by the same connection draw from one rate window instead of doubling it.
    A modality the corpus does not hold resolves nothing — a deleted image
    connection must not fail a text-only run.
    """
    chats: dict[EvalModality, ModalityChat] = {}
    for modality in (EvalModality.TEXT, EvalModality.IMAGE):
        if not any(plan.count_for(modality) for plan in doc_plans):
            continue
        choice = config.models.get(modality)
        if choice is None:
            raise InvalidInputError(
                f"The collection holds {modality.value} chunks, but no"
                f" {modality.value} model was configured for this dataset."
            )
        connection = resolve_connection(session, user, choice.connection_id)
        adapter = get_provider(connection, ProviderKind.CHAT)
        chats[modality] = ModalityChat(
            chat=throttled_chat(adapter, choice.connection_id),
            model=choice.model_name,
            pricing=catalog_pricing(adapter, ProviderKind.CHAT, choice.model_name),
        )
    return chats


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
    if state.doc_capped(plan.doc_id):
        return
    loaded = load_context(plan, setup.source.chunks_of(plan.doc_id), setup.source.storage)
    if loaded is None:
        return
    snippets = (
        distractor_texts(setup.doc_plans, plan, setup.source.chunks, rng)
        if plan.modality is EvalModality.TEXT
        else []
    )
    try:
        batch = generate_for_context(
            setup.chats[plan.modality],
            setup.config,
            context=loaded.context,
            plan=plan,
            distractor_snippets=snippets,
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
    state.usage = state.usage.merged_with(batch.usage)
    if state.done or state.doc_capped(plan.doc_id) or not batch.kept:
        return
    # One question per window. A window's surplus candidates are discarded
    # rather than deepening one document's share while another document,
    # whose own window sits later in the rota, still has none.
    candidate, scores = batch.kept[0]
    state.accepted.append(
        AcceptedQuestion(
            question=candidate.question,
            answer=candidate.answer,
            quote=candidate.quote,
            scores=scores,
            doc_id=plan.doc_id,
            chunk_ids=loaded.chunk_ids,
            question_type=plan.question_type.value,
            modality=plan.modality,
        )
    )
    state.accepted_texts.append(candidate.question)
    state.per_doc_accepted[plan.doc_id] = state.per_doc_accepted.get(plan.doc_id, 0) + 1


def _commit_progress(
    session: Session, dataset_id: UUID, accepted: int, usage: EvalUsage
) -> models.EvalDataset | None:
    """Persist progress and usage, returning the fresh row; None means cancelled.

    Both reads are explicit SELECTs (never identity-map hits), so a dataset
    row deleted from another session — the cancellation signal — is observed
    as None instead of a stale cached instance. Usage is committed on the
    same beat as progress so a polling client reads a running token count
    rather than one number at the end.
    """
    dataset = _select_dataset(session, dataset_id)
    if dataset is None:
        return None
    dataset.progress_done = accepted
    dataset.generation_usage = usage.model_dump(mode="json")
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
