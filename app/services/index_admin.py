"""Backend-aware index administration: list/describe/create/delete + backends.

The thin `/api/indexes` routes delegate here; this service dispatches through
`get_vector_store` (which owns per-backend prerequisites), applies the
backend's capability validation to create requests, and records index
lifecycle telemetry after the owning transaction commits.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.pgvector_support import pgvector_available
from app.schemas.enums import IndexBackend
from app.schemas.indexes import (
    BackendCapabilitiesRead,
    BackendInfoRead,
    IndexCreateRequest,
    IndexRead,
)
from app.telemetry import record
from app.telemetry.events import IndexCreated, IndexDeleted
from app.vectorstores.base import IndexSpec, VectorIndexDescription, validate_index_spec
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, backend_statuses, get_vector_store


def _to_read(description: VectorIndexDescription) -> IndexRead:
    """Map the internal description onto the stable wire schema."""
    return IndexRead.model_validate(description.model_dump())


class IndexAdminService:
    """Index management across every registered vector-store backend."""

    def __init__(self, session: Session) -> None:
        """Bind the service to the request session."""
        self._session = session

    def backends(self, user: models.User) -> list[BackendInfoRead]:
        """Describe every backend's usability for this user."""
        return [
            BackendInfoRead(
                backend=status.backend,
                label=status.label,
                available=status.available,
                configured=status.configured,
                capabilities=BackendCapabilitiesRead.model_validate(
                    status.capabilities.model_dump()
                ),
            )
            for status in backend_statuses(user)
        ]

    def list_indexes(self, user: models.User, backend: IndexBackend | None) -> list[IndexRead]:
        """List one backend's indexes, or every *usable* backend's when omitted."""
        backends = [backend] if backend else self._usable_backends(user)
        indexes: list[IndexRead] = []
        for candidate in backends:
            store = get_vector_store(candidate, user=user, session=self._session)
            indexes.extend(_to_read(description) for description in store.list_indexes())
        return indexes

    def describe_index(self, user: models.User, backend: IndexBackend, name: str) -> IndexRead:
        """Return one index's description."""
        store = get_vector_store(backend, user=user, session=self._session)
        return _to_read(store.describe_index(name))

    def create_index(self, user: models.User, request: IndexCreateRequest) -> IndexRead:
        """Capability-validate and create an index, recording telemetry."""
        spec = IndexSpec(
            name=request.name,
            dimension=request.dimension,
            metric=request.metric,
            vector_type=request.vector_type,
            cloud=request.cloud,
            region=request.region,
            deletion_protection=request.deletion_protection,
            tags=request.tags,
        )
        validate_index_spec(spec, CAPABILITIES_BY_BACKEND[request.backend])
        store = get_vector_store(request.backend, user=user, session=self._session)
        created = store.create_index(spec)
        self._session.commit()
        record(
            IndexCreated(
                user_id=user.id,
                backend=request.backend.value,
                index_name=request.name,
                dimension=request.dimension,
                metric=request.metric,
            )
        )
        return _to_read(created)

    def delete_index(self, user: models.User, backend: IndexBackend, name: str) -> None:
        """Delete an index by name, recording telemetry."""
        store = get_vector_store(backend, user=user, session=self._session)
        store.delete_index(name)
        self._session.commit()
        record(IndexDeleted(user_id=user.id, backend=backend.value, index_name=name))

    def _usable_backends(self, user: models.User) -> list[IndexBackend]:
        """Backends this user can list right now (pgvector present, key set)."""
        usable: list[IndexBackend] = []
        if pgvector_available():
            usable.append(IndexBackend.PGVECTOR)
        if (user.pinecone_api_key or "").strip():
            usable.append(IndexBackend.PINECONE)
        return usable
