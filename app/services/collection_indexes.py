"""The indexes a collection's bound pipelines name.

Read-only by construction. A pipeline names the index it reads and writes, so
there is nothing here for a collection to choose — but the collection still
has to be able to answer "where does my data live", and only it knows which
pipelines are bound to it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository, RegisteredIndexRepository
from app.pipelines.index_identity import collect_index_identities
from app.pipelines.registry import default_registry
from app.schemas.collections import CollectionIndexesRead, CollectionIndexTarget
from app.schemas.enums import IndexBackend
from app.services.pipelines import PipelineService


@dataclass
class _TargetDraft:
    """One index, merged across every binding whose graph names it."""

    name: str
    backend: IndexBackend
    vector_type: str
    dimension: int | None = None
    pipelines: list[str] = field(default_factory=list)


class CollectionIndexService:
    """Report the indexes a collection's bound pipelines target."""

    def __init__(self, session: Session) -> None:
        """Bind the service to the request session."""
        self._session = session
        self._bindings = CollectionPipelineBindingRepository(session)
        self._pipelines = PipelineService(session)
        self._indexes = RegisteredIndexRepository(session)

    def read(
        self, user: models.User, collection: models.Collection
    ) -> CollectionIndexesRead:
        """Merge every bound graph's index targets into one list."""
        drafts: dict[tuple[IndexBackend, str, str], _TargetDraft] = {}
        registry = default_registry()
        for binding in self._bindings.list_for_collection(collection.id):
            pipeline = self._pipelines.get_pipeline(binding.pipeline_id, user.id)
            if pipeline is None:
                continue
            try:
                definition = self._pipelines.get_definition(pipeline)
            except ValueError:
                continue
            for identity in collect_index_identities(definition, registry):
                key = (identity.backend, identity.name, identity.vector_type)
                draft = drafts.setdefault(
                    key,
                    _TargetDraft(
                        name=identity.name,
                        backend=identity.backend,
                        vector_type=identity.vector_type,
                        dimension=identity.dimension,
                    ),
                )
                if draft.dimension is None:
                    # A node states no width — the embedder beside it decides
                    # one — so the registration is what knows how wide the
                    # store is.
                    row = self._indexes.find_by_identity(
                        user.id, identity.backend, identity.name
                    )
                    draft.dimension = row.dimension if row is not None else None
                if pipeline.name not in draft.pipelines:
                    draft.pipelines.append(pipeline.name)
        return CollectionIndexesRead(
            targets=[
                CollectionIndexTarget(
                    name=draft.name,
                    backend=draft.backend,
                    vector_type=draft.vector_type,
                    dimension=draft.dimension,
                    pipelines=draft.pipelines,
                )
                # Dense first, then lexical: the semantic store is the one a
                # reader is looking for.
                for draft in sorted(drafts.values(), key=lambda d: (d.vector_type, d.name))
            ]
        )
