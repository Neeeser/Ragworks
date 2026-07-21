"""Triple assembly, persistence, and telemetry for synthetic generation.

The generator loop accumulates `AcceptedQuestion`s; this module turns them
(plus the full eligible corpus) into the standard `DatasetTriple`, persists it
through `EvalService.persist_triple`, and records the aggregatable telemetry
fact once the run settles.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.evals.generation.candidates import CritiqueScores
from app.evals.generation.corpus import join_chunks
from app.evals.service import EvalService
from app.schemas.enums import RelevanceGranularity
from app.telemetry import record
from app.telemetry.events import EvalDatasetGenerated

TEXT_MODALITY = "text"


@dataclass(frozen=True)
class AcceptedQuestion:
    """One question that survived every gate, with its provenance."""

    question: str
    answer: str
    quote: str
    scores: CritiqueScores
    doc_id: str
    chunk_ids: list[str]
    question_type: str


def persist_generated_dataset(
    session: Session,
    dataset: models.EvalDataset,
    *,
    documents: list[models.Document],
    chunk_map: dict[str, list[models.DocumentChunkRecord]],
    accepted: list[AcceptedQuestion],
    generated_count: int,
) -> None:
    """Assemble the triple, persist it, and stamp the generation stats."""
    corpus: list[CorpusDoc] = []
    for doc in documents:
        text = join_chunks([chunk.text for chunk in chunk_map.get(str(doc.id), [])])
        if text:
            corpus.append(
                CorpusDoc(
                    external_doc_id=str(doc.id),
                    title=doc.name,
                    text=text,
                    metadata={"modality": TEXT_MODALITY},
                )
            )
    queries: list[QueryRecord] = []
    qrels: list[Qrel] = []
    for index, item in enumerate(accepted, start=1):
        external_id = f"synth-{index:04d}"
        queries.append(
            QueryRecord(
                external_query_id=external_id,
                text=item.question,
                metadata={
                    "question_type": item.question_type,
                    "scores": item.scores.as_dict(),
                    "quote": item.quote,
                    "answer": item.answer,
                    "source_chunk_ids": item.chunk_ids,
                    "modality": TEXT_MODALITY,
                },
            )
        )
        qrels.append(
            Qrel(query_external_id=external_id, doc_external_id=item.doc_id, relevance=1)
        )
    triple = DatasetTriple(
        name=dataset.name,
        corpus=corpus,
        queries=queries,
        qrels=qrels,
        description=dataset.description,
        relevance_granularity=RelevanceGranularity.DOCUMENT,
    )
    dataset.generation_config = {
        **(dataset.generation_config or {}),
        "stats": {
            "generated": generated_count,
            "accepted": len(accepted),
            "documents_covered": len({item.doc_id for item in accepted}),
            "documents_total": len(corpus),
        },
    }
    dataset.progress_done = len(accepted)
    EvalService(session).persist_triple(dataset, triple)


def record_generation_outcome(
    session: Session, dataset_id: UUID, started: float, *, generated: int, accepted: int
) -> None:
    """Emit the aggregatable telemetry fact for a finished generation."""
    dataset = session.get(models.EvalDataset, dataset_id)
    if dataset is None:
        return
    config = dataset.generation_config or {}
    collection_ref = config.get("collection_id")
    try:
        collection_id = UUID(str(collection_ref))
    except ValueError:
        return
    record(
        EvalDatasetGenerated(
            user_id=dataset.user_id,
            dataset_id=dataset.id,
            collection_id=collection_id,
            status=dataset.status,
            generated_count=generated,
            accepted_count=accepted,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
    )
