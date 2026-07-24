"""Backend construction: the single place vector stores are built.

`get_vector_store` is also the single enforcement point for per-backend
prerequisites: requesting Pinecone without a configured API key, or pgvector
while the extension is unavailable, raises `InvalidInputError` (→ 400).
`VectorStoreProvider` wraps it lazily for pipeline runs so a pgvector run
never constructs a Pinecone client.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from sqlmodel import Session

from app.clients.pinecone import get_pinecone_client
from app.db import models
from app.db.pg_search_support import pg_search_available
from app.db.pgvector_support import pgvector_available
from app.db.repositories import ProviderConnectionRepository
from app.schemas.enums import IndexBackend, ProviderType
from app.services.errors import InvalidInputError
from app.vectorstores.base import VectorStoreBackend, VectorStoreCapabilities
from app.vectorstores.pgvector import PGVECTOR_CAPABILITIES, PgvectorStore
from app.vectorstores.pinecone import PINECONE_CAPABILITIES, PineconeStore

# pgvector first: the shipped default backend leads everywhere backends are
# enumerated (backend_statuses, capability-derived node support lists).
CAPABILITIES_BY_BACKEND: dict[IndexBackend, VectorStoreCapabilities] = {
    IndexBackend.PGVECTOR: PGVECTOR_CAPABILITIES,
    IndexBackend.PINECONE: PINECONE_CAPABILITIES,
}


def backends_where(
    predicate: Callable[[VectorStoreCapabilities], bool],
) -> tuple[IndexBackend, ...]:
    """Return the backends whose declared capabilities satisfy a predicate.

    The derivation behind node `supported_backends` lists: a new backend that
    declares a capability joins every dependent node's support list with no
    second place to update.
    """
    return tuple(
        backend
        for backend, capabilities in CAPABILITIES_BY_BACKEND.items()
        if predicate(capabilities)
    )

BACKEND_LABELS: dict[IndexBackend, str] = {
    IndexBackend.PINECONE: "Pinecone",
    IndexBackend.PGVECTOR: "pgvector (PostgreSQL)",
}

MISSING_PINECONE_KEY_DETAIL = (
    "No Pinecone connection is configured. Add one in Settings to continue."
)
PGVECTOR_UNAVAILABLE_DETAIL = (
    "The pgvector extension is not available on this deployment's Postgres "
    "server, so the pgvector index backend is disabled."
)


def _pinecone_api_key(user: models.User, session: Session) -> str | None:
    """Return the user's Pinecone credential from their connection, if any."""
    rows = ProviderConnectionRepository(session).list_for_user_of_type(
        user.id, ProviderType.PINECONE.value
    )
    for row in rows:
        api_key = str(row.config.get("api_key") or "").strip()
        if api_key:
            return api_key
    return None


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
    api_key = _pinecone_api_key(user, session)
    if not api_key:
        raise InvalidInputError(MISSING_PINECONE_KEY_DETAIL)
    return PineconeStore(get_pinecone_client(api_key))


def lexical_available(backend: IndexBackend) -> bool:
    """Runtime truth for sparse (BM25) indexes on a backend.

    Capability says the backend *could*; this says the deployment *can*
    (pgvector additionally needs both extensions present).
    """
    if not CAPABILITIES_BY_BACKEND[backend].supports_lexical:
        return False
    if backend is IndexBackend.PGVECTOR:
        return pgvector_available() and pg_search_available()
    return True


@dataclass(frozen=True)
class BackendStatus:
    """One backend's availability for a given user.

    `lexical_available` is the runtime truth for sparse (BM25) indexes —
    capability says the backend *could*, this says the deployment *can*
    (pgvector additionally needs the pg_search extension).
    """

    backend: IndexBackend
    label: str
    available: bool
    configured: bool
    lexical_available: bool
    capabilities: VectorStoreCapabilities


def backend_statuses(user: models.User, session: Session) -> list[BackendStatus]:
    """Describe every backend's usability for this user (pgvector first)."""
    pinecone_configured = _pinecone_api_key(user, session) is not None
    return [
        BackendStatus(
            backend=IndexBackend.PGVECTOR,
            label=BACKEND_LABELS[IndexBackend.PGVECTOR],
            available=pgvector_available(),
            configured=True,
            lexical_available=lexical_available(IndexBackend.PGVECTOR),
            capabilities=PGVECTOR_CAPABILITIES,
        ),
        BackendStatus(
            backend=IndexBackend.PINECONE,
            label=BACKEND_LABELS[IndexBackend.PINECONE],
            available=True,
            configured=pinecone_configured,
            lexical_available=lexical_available(IndexBackend.PINECONE),
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
