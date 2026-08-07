"""Reading the source collection for synthetic generation.

The generator consumes the collection's already-parsed representation: READY
documents and their stored chunk records, split by the modality each chunk
carries, plus distractor snippets drawn from other documents. A planned
window is resolved back into the content one model call reads here too, so
the loop never touches storage or chunk rows itself.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository
from app.evals.generation.contexts import (
    ContextPlan,
    DocumentPlan,
    GenerationContext,
    ImageContext,
    TextContext,
    pick_distractor_positions,
)
from app.evals.generation.corpus import join_chunks
from app.pipelines.image_assets import load_inline_media
from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY, image_asset_from_metadata
from app.schemas.enums import DocumentStatus, EvalModality
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)

DISTRACTOR_SNIPPET_CHARS = 600


@dataclass(frozen=True)
class DocumentChunks:
    """One document's stored chunks, split by the modality each carries."""

    text: list[models.DocumentChunkRecord] = field(default_factory=list)
    images: list[models.DocumentChunkRecord] = field(default_factory=list)

    def for_modality(self, modality: EvalModality) -> list[models.DocumentChunkRecord]:
        """The chunk list a plan of this modality indexes into."""
        return self.images if modality is EvalModality.IMAGE else self.text


@dataclass(frozen=True)
class LoadedContext:
    """A planned window resolved to callable content plus its chunk ids."""

    context: GenerationContext
    chunk_ids: list[str]


@dataclass(frozen=True)
class SourceCollection:
    """The collection a synthetic dataset is generated from.

    Its eligible documents, their chunks split by modality, and the storage
    their uploaded files are read back from — everything both the generation
    loop and the corpus assembly draw on.
    """

    documents: list[models.Document]
    chunks: dict[str, DocumentChunks]
    storage: FileStorage

    def chunks_of(self, doc_id: str) -> DocumentChunks:
        """One document's chunks, empty when it stored none."""
        return self.chunks.get(doc_id, DocumentChunks())


def eligible_documents(session: Session, collection_id: UUID) -> list[models.Document]:
    """READY documents with stored chunks, in a stable order."""
    documents = DocumentRepository(session).list_for_collection(collection_id)
    eligible = [
        doc for doc in documents if doc.status == DocumentStatus.READY and doc.num_chunks > 0
    ]
    eligible.sort(key=lambda doc: str(doc.id))
    return eligible


def load_chunks(
    session: Session, documents: list[models.Document]
) -> dict[str, DocumentChunks]:
    """Every eligible document's chunks, ordered, split by modality, keyed by id."""
    records = ChunkRepository(session).list_for_documents([doc.id for doc in documents])
    chunk_map: dict[str, DocumentChunks] = {}
    for record_ in records:
        bucket = chunk_map.setdefault(str(record_.document_id), DocumentChunks())
        if image_asset_from_metadata(record_.chunk_metadata) is None:
            bucket.text.append(record_)
        else:
            bucket.images.append(record_)
    return chunk_map


def has_image_chunks(session: Session, documents: list[models.Document]) -> bool:
    """True when any of the documents stored a chunk carrying an image asset.

    An existence probe, because the answer gates one request-time check:
    listing every chunk row of a 2000-page collection to answer yes/no
    drags each row's stored embedding through the request.
    """
    return ChunkRepository(session).any_with_metadata_key(
        [doc.id for doc in documents], IMAGE_ASSET_METADATA_KEY
    )


def load_context(
    plan: ContextPlan, chunks: DocumentChunks, storage: FileStorage
) -> LoadedContext | None:
    """Resolve a planned window into the content one call reads.

    None when the window resolves to nothing a model can be asked about: an
    empty slice, or a page image whose bytes are missing or over the
    configured inline limit. Skipping that context costs one question;
    failing the run would cost the whole dataset.
    """
    window = chunks.for_modality(plan.modality)[plan.start_index : plan.start_index + plan.span]
    if not window:
        return None
    chunk_ids = [str(chunk.id) for chunk in window]
    if plan.modality is not EvalModality.IMAGE:
        return LoadedContext(
            context=TextContext(text=join_chunks([chunk.text for chunk in window])),
            chunk_ids=chunk_ids,
        )
    asset = image_asset_from_metadata(window[0].chunk_metadata)
    if asset is None:
        return None
    try:
        image = load_inline_media(storage, media_type=asset.media_type, path=asset.path)
    except (OSError, InvalidInputError):
        logger.warning("Page image %s is unreadable; skipping its context", asset.path)
        return None
    return LoadedContext(context=ImageContext(image=image), chunk_ids=chunk_ids)


def distractor_texts(
    doc_plans: list[DocumentPlan],
    plan: ContextPlan,
    chunk_map: dict[str, DocumentChunks],
    rng: random.Random,
) -> list[str]:
    """Snippets from other documents, trimmed to prompt-friendly size."""
    texts: list[str] = []
    for doc_id, index in pick_distractor_positions(doc_plans, plan, rng=rng):
        chunks = chunk_map.get(doc_id, DocumentChunks()).text
        if index < len(chunks):
            texts.append(chunks[index].text[:DISTRACTOR_SNIPPET_CHARS])
    return texts
