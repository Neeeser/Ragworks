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
from tests.utils.providers import add_pinecone_connection


def _user(session: Session, email: str = "unit@example.com") -> models.User:
    user = models.User(email=email, hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_pgvector_store_resolves_without_any_connection(session: Session) -> None:
    store = get_vector_store(IndexBackend.PGVECTOR, user=_user(session), session=session)
    assert isinstance(store, PgvectorStore)


def test_pinecone_without_connection_rejected(session: Session) -> None:
    with pytest.raises(InvalidInputError, match="Pinecone connection"):
        get_vector_store(IndexBackend.PINECONE, user=_user(session), session=session)


def test_pinecone_with_connection_resolves(session: Session) -> None:
    user = _user(session)
    add_pinecone_connection(session, user, api_key="pk-123")
    store = get_vector_store(IndexBackend.PINECONE, user=user, session=session)
    assert isinstance(store, PineconeStore)


def test_pgvector_unavailable_rejected(session: Session) -> None:
    set_pgvector_available(False)
    try:
        with pytest.raises(InvalidInputError, match="pgvector extension"):
            get_vector_store(IndexBackend.PGVECTOR, user=_user(session), session=session)
    finally:
        set_pgvector_available(True)


def test_provider_caches_stores_and_stays_lazy(session: Session) -> None:
    provider = VectorStoreProvider(_user(session), session)

    # pgvector-only access never needs a Pinecone connection...
    first = provider.get(IndexBackend.PGVECTOR)
    assert provider.get(IndexBackend.PGVECTOR) is first
    # ...and the Pinecone failure only fires when Pinecone is requested.
    with pytest.raises(InvalidInputError, match="Pinecone connection"):
        provider.get(IndexBackend.PINECONE)


def test_backend_statuses_reports_configuration(session: Session) -> None:
    user = _user(session)
    statuses = {status.backend: status for status in backend_statuses(user, session)}

    pgvector = statuses[IndexBackend.PGVECTOR]
    assert pgvector.configured is True
    assert pgvector.capabilities.max_dimension == 4096
    assert pgvector.capabilities.requires_api_key is False

    pinecone = statuses[IndexBackend.PINECONE]
    assert pinecone.configured is False
    assert pinecone.capabilities.max_dimension == 20000

    keyed_user = _user(session, "keyed@example.com")
    add_pinecone_connection(session, keyed_user, api_key="pk-123")
    with_key = {
        status.backend: status for status in backend_statuses(keyed_user, session)
    }
    assert with_key[IndexBackend.PINECONE].configured is True
