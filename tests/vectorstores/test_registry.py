"""Registry construction rules and the lazy provider."""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.db.pgvector_support import set_pgvector_available
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError
from app.vectorstores.pgvector import PgvectorStore
from app.vectorstores.pinecone import PineconeStore
from app.vectorstores.registry import (
    VectorStoreProvider,
    backend_statuses,
    get_vector_store,
)


def _user(pinecone_key: str | None = None) -> models.User:
    return models.User(
        email="unit@example.com",
        hashed_password="hashed",
        pinecone_api_key=pinecone_key,
    )


def test_pgvector_store_resolves_without_any_api_key(session: Session) -> None:
    store = get_vector_store(IndexBackend.PGVECTOR, user=_user(), session=session)
    assert isinstance(store, PgvectorStore)


def test_pinecone_without_key_rejected(session: Session) -> None:
    with pytest.raises(InvalidInputError, match="Pinecone API key"):
        get_vector_store(IndexBackend.PINECONE, user=_user(), session=session)


def test_pinecone_with_key_resolves(session: Session) -> None:
    store = get_vector_store(IndexBackend.PINECONE, user=_user("pk-123"), session=session)
    assert isinstance(store, PineconeStore)


def test_pgvector_unavailable_rejected(session: Session) -> None:
    set_pgvector_available(False)
    try:
        with pytest.raises(InvalidInputError, match="pgvector extension"):
            get_vector_store(IndexBackend.PGVECTOR, user=_user(), session=session)
    finally:
        set_pgvector_available(True)


def test_provider_caches_stores_and_stays_lazy(session: Session) -> None:
    provider = VectorStoreProvider(_user(), session)

    # pgvector-only access never needs a Pinecone key...
    first = provider.get(IndexBackend.PGVECTOR)
    assert provider.get(IndexBackend.PGVECTOR) is first
    # ...and the Pinecone failure only fires when Pinecone is requested.
    with pytest.raises(InvalidInputError, match="Pinecone API key"):
        provider.get(IndexBackend.PINECONE)


def test_backend_statuses_reports_configuration(session: Session) -> None:
    statuses = {status.backend: status for status in backend_statuses(_user())}

    pgvector = statuses[IndexBackend.PGVECTOR]
    assert pgvector.configured is True
    assert pgvector.capabilities.max_dimension == 2000
    assert pgvector.capabilities.requires_api_key is False

    pinecone = statuses[IndexBackend.PINECONE]
    assert pinecone.configured is False
    assert pinecone.capabilities.max_dimension == 20000

    with_key = {status.backend: status for status in backend_statuses(_user("pk-123"))}
    assert with_key[IndexBackend.PINECONE].configured is True
