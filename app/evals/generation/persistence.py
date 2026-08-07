"""Triple assembly, persistence, and telemetry for synthetic generation.

The generator loop accumulates `AcceptedQuestion`s; this module turns them
(plus the full eligible corpus) into the standard `DatasetTriple`, persists it
through `EvalService.persist_triple`, and records the aggregatable telemetry
fact once the run settles.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.evals.datasets.media import DatasetMediaStore
from app.evals.generation.candidates import CritiqueScores
from app.evals.generation.corpus import join_chunks
from app.evals.generation.sources import SourceCollection
from app.evals.service import EvalService
from app.pipelines.payloads import MediaAsset
from app.schemas.enums import EvalModality, RelevanceGranularity
from app.telemetry import record
from app.telemetry.events import EvalDatasetGenerated
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)


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
    modality: EvalModality = EvalModality.TEXT


def build_corpus(source: SourceCollection, media: DatasetMediaStore) -> list[CorpusDoc]:
    """Assemble the corpus, copying the original file for image documents.

    A document with any image chunk is represented by the file its owner
    uploaded rather than by reconstructed chunk text: for a page-image PDF
    that reconstruction is a run of `[image: …]` placeholders, and a corpus
    of placeholders cannot be retrieved against. Reconstructed text still
    travels beside the file when the document also produced real text chunks,
    so a mixed PDF keeps both.
    """
    corpus: list[CorpusDoc] = []
    for doc in source.documents:
        chunks = source.chunks_of(str(doc.id))
        text = join_chunks([chunk.text for chunk in chunks.text]) or None
        asset = (
            _copy_source_file(doc, storage=source.storage, media=media) if chunks.images else None
        )
        if text is None and asset is None:
            continue
        modality = EvalModality.IMAGE if asset is not None else EvalModality.TEXT
        corpus.append(
            CorpusDoc(
                external_doc_id=str(doc.id),
                title=doc.name,
                text=text,
                media=asset,
                metadata={"modality": modality.value},
            )
        )
    return corpus


def persist_generated_dataset(
    session: Session,
    dataset: models.EvalDataset,
    *,
    source: SourceCollection,
    accepted: list[AcceptedQuestion],
    generated_count: int,
    media: DatasetMediaStore,
) -> None:
    """Assemble the triple, persist it, and stamp the generation stats."""
    corpus = build_corpus(source, media)
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
                    "modality": item.modality.value,
                },
            )
        )
        qrels.append(Qrel(query_external_id=external_id, doc_external_id=item.doc_id, relevance=1))
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


def _copy_source_file(
    doc: models.Document, *, storage: FileStorage, media: DatasetMediaStore
) -> MediaAsset | None:
    """Copy a document's uploaded file into the dataset's media store.

    None when the file no longer reads back; the document then contributes
    whatever text it produced, or drops out of the corpus entirely, rather
    than failing the whole dataset over one missing upload.
    """
    if not doc.source_path:
        return None
    try:
        data = storage.read_bytes(doc.source_path)
    except OSError:
        logger.warning("Source file for document %s is unreadable; storing no media", doc.id)
        return None
    return media.write("docs", str(doc.id), content_type=doc.content_type, data=data)
