"""One corpus document inside an eval collection: its file name and its ingest.

A benchmark corpus document is materialized as an ordinary file whose name
encodes its external id and whose extension encodes its content type, then
ingested through the pipeline under test — synchronously, because the run has
to wait for it, which is why this drives `IngestionService` directly instead of
going through the queue. Selecting the documents that need (re)ingesting is not
eval-specific and lives on `DocumentRepository`.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from uuid import UUID

from app.db import models
from app.db.engine import session_scope
from app.pipelines.payloads import MediaAsset
from app.schemas.content_types import (
    CONTENT_TYPE_EXTENSIONS,
    FALLBACK_EXTENSION,
    extension_for,
)
from app.services.errors import InvalidInputError
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[], None]

#: The content type a corpus document with no media is materialized under.
TEXT_CONTENT_TYPE = "text/plain"

#: Every extension a materialized corpus file can end in. Recovering an
#: external id has to strip whichever one it was written with, so a `.png`
#: page image maps back to the same id a `.txt` document would.
_KNOWN_EXTENSIONS: frozenset[str] = frozenset(CONTENT_TYPE_EXTENSIONS.values()) | {
    FALLBACK_EXTENSION
}


def file_name_for(external_doc_id: str, content_type: str) -> str:
    """Build the file name encoding a corpus doc's external id and content type."""
    safe = external_doc_id.replace("/", "_")
    if not safe:
        raise InvalidInputError("Corpus document has an empty external id.")
    return f"{safe}{extension_for(content_type)}"


def external_id_from_name(name: str) -> str:
    """Recover the external doc id from the file/document name."""
    for extension in _KNOWN_EXTENSIONS:
        if name.endswith(extension):
            return name[: -len(extension)]
    return name


def corpus_media(corpus_doc: models.EvalDatasetDocument) -> MediaAsset | None:
    """Return the stored media a corpus document carries, if any."""
    if corpus_doc.media is None:
        return None
    return MediaAsset.model_validate(corpus_doc.media)


def file_name_for_document(corpus_doc: models.EvalDatasetDocument) -> str:
    """Build the file name one corpus document is materialized under."""
    media = corpus_media(corpus_doc)
    content_type = media.media_type if media is not None else TEXT_CONTENT_TYPE
    return file_name_for(corpus_doc.external_doc_id, content_type)


def ingest_all(
    user_id: UUID,
    collection_id: UUID,
    document_ids: list[UUID],
    on_document_done: ProgressCallback | None,
    concurrency: int,
) -> None:
    """Ingest registered documents: serial until one succeeds, then pooled.

    The first successful ingest creates the pipeline's indexes, so pooled
    workers never race index creation; the remainder then fans out, each
    worker in its own session.
    """
    remaining = list(document_ids)
    while remaining:
        succeeded = ingest_one(user_id, collection_id, remaining.pop(0))
        if on_document_done is not None:
            on_document_done()
        if succeeded:
            break
    if not remaining:
        return
    with ThreadPoolExecutor(max_workers=max(concurrency, 1)) as pool:
        futures = [
            pool.submit(ingest_one, user_id, collection_id, document_id)
            for document_id in remaining
        ]
        for future in as_completed(futures):
            future.result()
            if on_document_done is not None:
                on_document_done()


def ingest_one(user_id: UUID, collection_id: UUID, document_id: UUID) -> bool:
    """Ingest one registered corpus document in its own session.

    Worker-safe: loads its rows fresh and never touches the provisioner's
    session. A failure is deliberately non-fatal, mirroring background
    ingestion — the FAILED document row is the recorded outcome (stage-0
    funnel loss), and one unparseable/failing doc must not kill the run.
    """
    with session_scope() as session:
        user = session.get(models.User, user_id)
        collection = session.get(models.Collection, collection_id)
        document = session.get(models.Document, document_id)
        if user is None or collection is None or document is None:
            return False
        try:
            IngestionService(session).ingest_document(
                user=user, collection=collection, document=document
            )
        except Exception:
            # Deliberately broad: see docstring.
            logger.exception("Eval corpus document %s failed to ingest", document.name)
            return False
        return True
