"""Attributing ingestion token usage to the run that actually spent it."""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import Session

from app.db import models
from app.db.repositories import IngestionEventRepository
from app.schemas.enums import ChunkStrategy, DocumentStatus
from app.utils.time import utc_now


def _document(session: Session) -> models.Document:
    user = models.User(email=f"ing-{utc_now().timestamp()}@example.com", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    collection = models.Collection(name="Corpus", user_id=user.id)
    session.add(collection)
    session.commit()
    session.refresh(collection)
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=DocumentStatus.READY,
        num_chunks=0,
        num_tokens=0,
        chunk_size=512,
        chunk_overlap=0,
        chunk_strategy=ChunkStrategy.TOKEN,
        embedding_model="test-embed",
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def _event(session: Session, document: models.Document, tokens: int, *, status: str) -> None:
    session.add(
        models.IngestionEvent(
            document_id=document.id,
            collection_id=document.collection_id,
            event_type="ingestion_complete",
            status=status,
            details={"usage": {"prompt_tokens": tokens, "total_tokens": tokens}},
        )
    )
    session.commit()


def test_an_earlier_runs_usage_is_not_billed_to_this_one(session: Session) -> None:
    """A pre-run success event whose re-ingest failed contributes nothing.

    A READY document holding no chunks is re-attempted by every eval run, so
    it reaches the repository already carrying an earlier run's success
    event. Reading "the newest success event" would charge this run for
    tokens an earlier one spent, on an attempt that produced nothing.
    """
    document = _document(session)
    _event(session, document, 500, status="success")

    since = utc_now() + timedelta(seconds=1)
    _event(session, document, 700, status="failed")

    usage = IngestionEventRepository(session).usage_for_documents([document.id], since)

    assert usage.is_empty()


def test_this_runs_own_ingest_is_counted(session: Session) -> None:
    """A success event inside the window is the spend this run performed."""
    document = _document(session)
    _event(session, document, 500, status="success")

    since = utc_now() - timedelta(seconds=1)

    usage = IngestionEventRepository(session).usage_for_documents([document.id], since)

    assert usage.total_tokens == 500
