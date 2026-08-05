"""Requeue a collection's documents that never reached the index.

The repair path behind both "retry failed files" on an ordinary collection and
the eval corpus retry: one question — which documents are not in the index and
not currently being ingested — answered the same way for both, since an eval
collection is an ordinary collection carrying `system_purpose="eval"`.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository


def requeue_unindexed_documents(session: Session, collection: models.Collection) -> list[UUID]:
    """Reset every unindexed document in the collection to `pending`.

    Returns the requeued ids. The caller commits and enqueues them, because a
    worker claims the row through its own session and an uncommitted `pending`
    is invisible to it.
    """
    documents = DocumentRepository(session)
    return documents.mark_pending(documents.list_unindexed_for_collection(collection.id))
