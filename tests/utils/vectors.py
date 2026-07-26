"""Shared construction for pgvector stores in tests.

`PgvectorStore` is scoped to an account: its catalog listing shows only that
account's indexes plus owner-less ones. Tests that build a store per step
must therefore agree on one owner, or an index created through one store
becomes invisible to the next — so the owner lives here rather than being
re-invented per file.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.vectorstores.pgvector import PgvectorStore

#: The account every test store belongs to unless a test names another.
TEST_OWNER_ID = UUID("00000000-0000-0000-0000-00000000a11c")


def pgvector_store(session: Session, owner_id: UUID = TEST_OWNER_ID) -> PgvectorStore:
    """Build a pgvector store for one account (the shared test owner)."""
    return PgvectorStore(session, owner_id)
