"""Backend-aware index administration: list/describe/create/delete + backends.

The thin `/api/indexes` routes delegate here; this service dispatches through
`get_vector_store` (which owns per-backend prerequisites), applies the
backend's capability validation to create requests, and records index
lifecycle telemetry after the owning transaction commits.

Listings merge two sources: what each backend physically holds, and the
registry rows (`app/services/index_registry.py`) that make an index pickable
by a pipeline binding. Both directions are reported honestly — a physical
index with no row is adoptable, and a row whose store no longer holds the
index is flagged rather than quietly dropped, because a binding may still
point at it.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.schemas.enums import IndexBackend
from app.schemas.indexes import (
    BackendCapabilitiesRead,
    BackendInfoRead,
    IndexCreateRequest,
    IndexRead,
    IndexRegisterRequest,
    IndexUsageRead,
)
from app.services.errors import InvalidInputError
from app.services.index_registry import IndexRegistryService, IndexUsage
from app.services.namespace_ownership import has_foreign_namespace
from app.telemetry import record
from app.telemetry.events import IndexCreated, IndexDeleted
from app.vectorstores.base import (
    IndexSpec,
    VectorIndexDescription,
    VectorStoreBackend,
    validate_index_spec,
)
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, backend_statuses, get_vector_store


def _to_read(description: VectorIndexDescription) -> IndexRead:
    """Map the internal description onto the stable wire schema."""
    return IndexRead.model_validate(description.model_dump())


def _usage_reads(usages: list[IndexUsage]) -> list[IndexUsageRead]:
    """Map internal usages onto the wire shape the manager renders."""
    return [
        IndexUsageRead(
            collection_id=usage.collection.id,
            collection_name=usage.collection.name,
            pipeline_id=usage.pipeline.id,
            pipeline_name=usage.pipeline.name,
            role=models.BindingRole(usage.binding.role).value,
        )
        for usage in usages
    ]


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
                lexical_available=status.lexical_available,
                capabilities=BackendCapabilitiesRead.model_validate(
                    status.capabilities.model_dump()
                ),
            )
            for status in backend_statuses(user, self._session)
        ]

    def list_indexes(self, user: models.User, backend: IndexBackend | None) -> list[IndexRead]:
        """List one backend's indexes, or every *usable* backend's when omitted.

        Physical indexes and registry rows are merged on `(backend, name)`, so
        each index appears exactly once carrying both its store metadata and
        whether a pipeline can point at it.
        """
        backends = [backend] if backend else self._usable_backends(user)
        registry = IndexRegistryService(self._session)
        registered = {
            (row.backend, row.name): row for row in registry.list_registered(user, backend)
        }
        usages = registry.usages_by_index(user)
        indexes: list[IndexRead] = []
        seen: set[tuple[IndexBackend, str]] = set()
        for candidate in backends:
            store = get_vector_store(candidate, user=user, session=self._session)
            for description in store.list_indexes():
                key = (description.backend, description.name)
                seen.add(key)
                indexes.append(self._merged_read(description, registered.get(key), usages))
        for key, row in registered.items():
            if key in seen:
                continue
            indexes.append(self._orphan_read(row, usages))
        return indexes

    def describe_index(self, user: models.User, backend: IndexBackend, name: str) -> IndexRead:
        """Return one index's description, including its registration."""
        store = get_vector_store(backend, user=user, session=self._session)
        registry = IndexRegistryService(self._session)
        row = RegisteredIndexRepository(self._session).find_by_identity(user.id, backend, name)
        return self._merged_read(store.describe_index(name), row, registry.usages_by_index(user))

    def register_index(self, user: models.User, request: IndexRegisterRequest) -> IndexRead:
        """Adopt a physically-existing index so bindings can point at it.

        The store's own description supplies dimension, metric, and vector
        type: an adopted index's parameters are whatever it was actually
        built with, and asking the user to retype them invites a row that
        disagrees with the store.
        """
        store = get_vector_store(request.backend, user=user, session=self._session)
        description = store.describe_index(request.name)
        registry = IndexRegistryService(self._session)
        row = registry.register(
            user,
            request.backend,
            request.name,
            vector_type=description.vector_type or "dense",
            dimension=description.dimension,
            metric=description.metric,
        )
        return self._merged_read(description, row, registry.usages_by_index(user))

    def unregister_index(self, user: models.User, index_id: UUID) -> None:
        """Drop a registration (never the index itself) once nothing uses it."""
        registry = IndexRegistryService(self._session)
        registry.unregister(user, registry.get(user, index_id))

    @staticmethod
    def _merged_read(
        description: VectorIndexDescription,
        row: models.RegisteredIndex | None,
        usages: dict[UUID, list[IndexUsage]],
    ) -> IndexRead:
        """Combine a store description with its registration row, if any."""
        read = _to_read(description)
        if row is None:
            return read
        return read.model_copy(
            update={
                "index_id": row.id,
                "registered": True,
                "in_use_by": _usage_reads(usages.get(row.id, [])),
            }
        )

    @staticmethod
    def _orphan_read(
        row: models.RegisteredIndex,
        usages: dict[UUID, list[IndexUsage]],
    ) -> IndexRead:
        """Describe a registered index the store no longer holds.

        Reported rather than hidden: a binding may still target it, and the
        store creates it again on the next ingest, so silence here would read
        as "that index is gone" while the pipeline disagrees.
        """
        return IndexRead(
            name=row.name,
            backend=row.backend,
            vector_type=row.vector_type,
            metric=row.metric,
            dimension=row.dimension,
            index_id=row.id,
            registered=True,
            exists=False,
            in_use_by=_usage_reads(usages.get(row.id, [])),
        )

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
        registry = IndexRegistryService(self._session)
        # Registered on creation: an index the app just made is one the user
        # obviously means to use, and leaving it unregistered would offer them
        # an "adopt" step for their own brand-new index.
        row = registry.register(
            user,
            request.backend,
            request.name,
            vector_type=request.vector_type,
            dimension=request.dimension,
            metric=request.metric if request.vector_type == "dense" else None,
        )
        record(
            IndexCreated(
                user_id=user.id,
                backend=request.backend.value,
                index_name=request.name,
                dimension=request.dimension,
                metric=request.metric,
            )
        )
        return self._merged_read(created, row, {})

    def delete_index(self, user: models.User, backend: IndexBackend, name: str) -> None:
        """Delete an index by name, recording telemetry.

        Refuses while a binding still targets it: dropping the store under a
        live pipeline turns every later run into empty results with no error
        to explain them.

        Refuses too when another account has registered the same name on a
        backend whose names are shared workspace-wide — that check runs
        whether or not the caller registered the index themselves, because
        every account can see (and therefore delete) a shared name — and
        when the index physically holds another account's rows. Both run:
        a registration is a declaration that survives an empty index, while
        stored rows are a fact that survives an account dropping its
        registration.
        """
        registry = IndexRegistryService(self._session)
        indexes = RegisteredIndexRepository(self._session)
        row = indexes.find_by_identity(user.id, backend, name)
        if row is not None:
            registry.ensure_unused(user, row)
        store = get_vector_store(backend, user=user, session=self._session)
        if CAPABILITIES_BY_BACKEND[backend].shared_across_users:
            registry.ensure_no_other_owner(user, backend, name)
            self._ensure_no_foreign_rows(user, store, name, backend)
        store.delete_index(name)
        if row is not None:
            indexes.delete(row)
        self._session.commit()
        record(IndexDeleted(user_id=user.id, backend=backend.value, index_name=name))

    def _ensure_no_foreign_rows(
        self,
        user: models.User,
        store: VectorStoreBackend,
        name: str,
        backend: IndexBackend,
    ) -> None:
        """Raise when the shared index holds rows from another account.

        The registration check alone leaves a hole: unregistering explicitly
        keeps the data (it is what the refusal message recommends), so an
        account that stops declaring an index still has vectors inside it,
        and the next caller's delete drops the table under them. Stored
        namespaces are the fact that outlives the declaration.
        """
        if not has_foreign_namespace(self._session, store.stored_namespaces(name), user.id):
            return
        raise InvalidInputError(
            f"Index '{name}' holds data belonging to another account, and "
            f"{backend.value} stores one physical index per name for the whole "
            "deployment — deleting it here would destroy that data. Remove your "
            "registration instead, which leaves the index in place."
        )

    def _usable_backends(self, user: models.User) -> list[IndexBackend]:
        """Backends this user can list right now (pgvector present, connection set)."""
        return [
            status.backend
            for status in backend_statuses(user, self._session)
            if status.available and status.configured
        ]
