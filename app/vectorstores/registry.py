"""Backend construction: the single place vector stores are built.

`get_vector_store` is also the single enforcement point for per-backend
prerequisites: requesting Pinecone without a configured API key, or pgvector
while the extension is unavailable, raises `InvalidInputError` (→ 400).
`VectorStoreProvider` wraps it lazily for pipeline runs so a pgvector run
never constructs a Pinecone client.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session

from app.clients.pinecone import get_pinecone_client
from app.db import models
from app.db.pgvector_support import pgvector_available
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError
from app.vectorstores.base import VectorStoreBackend, VectorStoreCapabilities
from app.vectorstores.pgvector import PGVECTOR_CAPABILITIES, PgvectorStore
from app.vectorstores.pinecone import PINECONE_CAPABILITIES, PineconeStore

CAPABILITIES_BY_BACKEND: dict[IndexBackend, VectorStoreCapabilities] = {
    IndexBackend.PINECONE: PINECONE_CAPABILITIES,
    IndexBackend.PGVECTOR: PGVECTOR_CAPABILITIES,
}

BACKEND_LABELS: dict[IndexBackend, str] = {
    IndexBackend.PINECONE: "Pinecone",
    IndexBackend.PGVECTOR: "pgvector (PostgreSQL)",
}

MISSING_PINECONE_KEY_DETAIL = (
    "Pinecone API key is not configured. Update it in Settings to continue."
)
PGVECTOR_UNAVAILABLE_DETAIL = (
    "The pgvector extension is not available on this deployment's Postgres "
    "server, so the pgvector index backend is disabled."
)


def get_vector_store(
    backend: IndexBackend,
    *,
    user: models.User,
    session: Session,
) -> VectorStoreBackend:
    """Construct the store for a backend, enforcing its prerequisites."""
    if backend is IndexBackend.PGVECTOR:
        if not pgvector_available():
            raise InvalidInputError(PGVECTOR_UNAVAILABLE_DETAIL)
        return PgvectorStore(session)
    api_key = (user.pinecone_api_key or "").strip()
    if not api_key:
        raise InvalidInputError(MISSING_PINECONE_KEY_DETAIL)
    return PineconeStore(get_pinecone_client(api_key))


@dataclass(frozen=True)
class BackendStatus:
    """One backend's availability for a given user."""

    backend: IndexBackend
    label: str
    available: bool
    configured: bool
    capabilities: VectorStoreCapabilities


def backend_statuses(user: models.User) -> list[BackendStatus]:
    """Describe every backend's usability for this user (pgvector first)."""
    pinecone_configured = bool((user.pinecone_api_key or "").strip())
    return [
        BackendStatus(
            backend=IndexBackend.PGVECTOR,
            label=BACKEND_LABELS[IndexBackend.PGVECTOR],
            available=pgvector_available(),
            configured=True,
            capabilities=PGVECTOR_CAPABILITIES,
        ),
        BackendStatus(
            backend=IndexBackend.PINECONE,
            label=BACKEND_LABELS[IndexBackend.PINECONE],
            available=True,
            configured=pinecone_configured,
            capabilities=PINECONE_CAPABILITIES,
        ),
    ]


class VectorStoreProvider:
    """Lazy per-run store factory bound to one user and session.

    Replaces the raw `Pinecone` client on `PipelineRunContext`: stores are
    constructed on first use and cached for the run, so a pgvector-only run
    never builds a Pinecone client (and needs no Pinecone key).
    """

    def __init__(self, user: models.User, session: Session) -> None:
        """Bind the provider to the run's user and session."""
        self._user = user
        self._session = session
        self._stores: dict[IndexBackend, VectorStoreBackend] = {}

    def get(self, backend: IndexBackend) -> VectorStoreBackend:
        """Return the (cached) store for a backend."""
        if backend not in self._stores:
            self._stores[backend] = get_vector_store(
                backend, user=self._user, session=self._session
            )
        return self._stores[backend]
