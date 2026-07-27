"""Registered indexes: reading, adopting, and finding who points at one.

An index a pipeline can target is a `RegisteredIndex` row, not a bare string.
This module owns the question that needs both the registry and the stored
pipeline definitions: **who is using this index?** — which deletion consults
so an index a pipeline still targets cannot be removed out from under it.

`IndexUsage` deliberately reads *declared* references rather than observed
runs: a pipeline that has not run yet still owns its index, and waiting for a
run to prove it would let the first delete succeed silently.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    RegisteredIndexRepository,
)
from app.pipelines.index_identity import collect_index_identities
from app.pipelines.registry import default_registry
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipelines import PipelineService


@dataclass(frozen=True)
class IndexUsage:
    """One binding's reference to one registered index."""

    index_id: UUID
    collection: models.Collection
    pipeline: models.Pipeline
    binding: models.CollectionPipelineBinding


class IndexRegistryService:
    """Registration, adoption, and usage of a user's vector indexes."""

    def __init__(self, session: Session) -> None:
        """Bind the service to the request session."""
        self._session = session
        self._indexes = RegisteredIndexRepository(session)

    def list_registered(
        self, user: models.User, backend: IndexBackend | None = None
    ) -> list[models.RegisteredIndex]:
        """List the user's registered indexes."""
        return self._indexes.list_for_user(user.id, backend=backend)

    def get(self, user: models.User, index_id: UUID) -> models.RegisteredIndex:
        """Return one registered index the user owns, else raise `NotFoundError`."""
        index = self._indexes.get(index_id, user.id)
        if index is None:
            raise NotFoundError("Index not found.")
        return index

    def register(
        self,
        user: models.User,
        backend: IndexBackend,
        name: str,
        *,
        vector_type: str = "dense",
        dimension: int | None = None,
        metric: str | None = None,
    ) -> models.RegisteredIndex:
        """Register an index, returning the existing row when already known."""
        index = self._indexes.get_or_create(
            user.id,
            backend,
            name,
            vector_type=vector_type,
            dimension=dimension,
            metric=metric,
        )
        self._session.commit()
        self._session.refresh(index)
        return index

    def usages(self, user: models.User) -> list[IndexUsage]:
        """Return every declared reference from a binding to a registered index."""
        bindings = CollectionPipelineBindingRepository(self._session).list_for_user(user.id)
        if not bindings:
            return []
        collections = {
            collection.id: collection
            for collection in CollectionRepository(self._session).list_for_user(user.id)
        }
        rows = {
            (row.backend, row.name): row for row in self._indexes.list_for_user(user.id)
        }
        return list(self._iter_usages(bindings, collections, rows))

    def usages_by_index(self, user: models.User) -> dict[UUID, list[IndexUsage]]:
        """Group `usages()` by the index each reference points at."""
        grouped: dict[UUID, list[IndexUsage]] = {}
        for usage in self.usages(user):
            grouped.setdefault(usage.index_id, []).append(usage)
        return grouped

    def ensure_unused(self, user: models.User, index: models.RegisteredIndex) -> None:
        """Raise when a binding still points at the index.

        Deleting a registration a pipeline targets would leave that pipeline
        writing to (or reading from) a store nothing in the app admits to
        owning, so the error names the collections instead.
        """
        usages = self.usages_by_index(user).get(index.id, [])
        if not usages:
            return
        names = ", ".join(sorted({usage.collection.name for usage in usages}))
        raise InvalidInputError(
            f"Index '{index.name}' is still used by: {names}. "
            "Point those collections at another index first."
        )

    def ensure_no_other_owner(
        self, user: models.User, backend: IndexBackend, name: str
    ) -> None:
        """Raise when another account has registered the same `(backend, name)`.

        On a backend whose index names are shared workspace-wide, one name is
        one physical store for every account, so destroying it here destroys
        vectors belonging to someone who never saw the action and cannot
        undo it. Registration is the ownership signal, matching
        `ensure_unused`'s declared-reference rule; the other account is not
        named, because a user must not be able to enumerate their neighbours.
        """
        if not RegisteredIndexRepository(self._session).other_owner_exists(
            user.id, backend, name
        ):
            return
        raise InvalidInputError(
            f"Index '{name}' is also registered by another account, and "
            f"{backend.value} stores one physical index per name for the whole "
            "deployment — deleting it here would destroy that account's vectors. "
            "Remove your registration instead, which leaves the index in place."
        )

    def unregister(self, user: models.User, index: models.RegisteredIndex) -> None:
        """Delete a registration row after checking nothing references it."""
        self.ensure_unused(user, index)
        self._indexes.delete(index)
        self._session.commit()

    def _iter_usages(
        self,
        bindings: Iterable[models.CollectionPipelineBinding],
        collections: dict[UUID, models.Collection],
        rows: dict[tuple[IndexBackend, str], models.RegisteredIndex],
    ) -> Iterator[IndexUsage]:
        """Yield one usage per index a bound pipeline's graph names.

        Read from the definition, because that is where an index is chosen:
        a binding contributes only the collection the pipeline runs for.
        """
        pipelines = PipelineService(self._session)
        registry = default_registry()
        for binding in bindings:
            collection = collections.get(binding.collection_id)
            if collection is None:
                continue
            pipeline = self._session.get(models.Pipeline, binding.pipeline_id)
            if pipeline is None:
                continue
            try:
                definition = pipelines.get_definition(pipeline)
            except ValueError:
                continue
            for identity in collect_index_identities(definition, registry):
                row = rows.get((identity.backend, identity.name))
                if row is None:
                    continue
                yield IndexUsage(
                    index_id=row.id,
                    collection=collection,
                    pipeline=pipeline,
                    binding=binding,
                )
