"""Reading the source collection for synthetic generation.

The generator consumes the collection's already-parsed representation: READY
documents and their stored chunk records, plus distractor snippets drawn from
other documents.
"""

from __future__ import annotations

import random
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository
from app.evals.generation.contexts import (
    ContextPlan,
    DocumentPlan,
    pick_distractor_positions,
)
from app.schemas.enums import DocumentStatus

DISTRACTOR_SNIPPET_CHARS = 600


def eligible_documents(
    session: Session, collection_id: UUID
) -> list[models.Document]:
    """READY documents with stored chunks, in a stable order."""
    documents = DocumentRepository(session).list_for_collection(collection_id)
    eligible = [
        doc
        for doc in documents
        if doc.status == DocumentStatus.READY and doc.num_chunks > 0
    ]
    eligible.sort(key=lambda doc: str(doc.id))
    return eligible


def load_chunks(
    session: Session, documents: list[models.Document]
) -> dict[str, list[models.DocumentChunkRecord]]:
    """Every eligible document's chunks, ordered, keyed by document id."""
    records = ChunkRepository(session).list_for_documents([doc.id for doc in documents])
    chunk_map: dict[str, list[models.DocumentChunkRecord]] = {}
    for record_ in records:
        chunk_map.setdefault(str(record_.document_id), []).append(record_)
    return chunk_map


def distractor_texts(
    doc_plans: list[DocumentPlan],
    plan: ContextPlan,
    chunk_map: dict[str, list[models.DocumentChunkRecord]],
    rng: random.Random,
) -> list[str]:
    """Snippets from other documents, trimmed to prompt-friendly size."""
    texts: list[str] = []
    for doc_id, index in pick_distractor_positions(doc_plans, plan, rng=rng):
        chunks = chunk_map.get(doc_id, [])
        if index < len(chunks):
            texts.append(chunks[index].text[:DISTRACTOR_SNIPPET_CHARS])
    return texts
