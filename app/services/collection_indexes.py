"""A collection's indexes: the ones its graphs name, and the slots they expose.

Most bindings name their own index, so the collection reports them as
read-only *targets* — the Overview still has to say where the corpus lives
even when there is nothing to choose. A pipeline whose author deliberately
exposed an index variable contributes a *slot* instead: a question only a
collection can answer. Slots merge by name across bindings, because ingestion
must write where retrieval reads, and one update fans out to every binding
declaring the slot — the per-binding endpoints remain for deliberate
divergence.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository, RegisteredIndexRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.index_identity import collect_index_identities
from app.pipelines.registry import default_registry
from app.pipelines.settings import resolve_pipeline_settings
from app.schemas.collections import (
    CollectionIndexesRead,
    CollectionIndexRef,
    CollectionIndexSlot,
    CollectionIndexTarget,
)
from app.schemas.enums import IndexBackend
from app.services.binding_variables import (
    ensure_declared_somewhere,
    resolve_binding_values,
    subset_declared,
)
from app.services.index_compatibility import index_variable_vector_types
from app.services.index_registry import index_variables, selected_indexes
from app.services.pipelines import PipelineService


@dataclass
class _BoundPipeline:
    """One binding with its pipeline and parsed definition, resolved once."""

    binding: models.CollectionPipelineBinding
    pipeline: models.Pipeline
    definition: PipelineDefinition


@dataclass
class _TargetDraft:
    """A literal index target being merged across bindings."""

    name: str
    backend: IndexBackend
    vector_type: str
    dimension: int | None = None
    pipelines: list[str] = field(default_factory=list)


@dataclass
class _SlotDraft:
    """A slot being merged across bindings before projection."""

    name: str
    vector_type: str = "dense"
    description: str | None = None
    expected_dimension: int | None = None
    current: CollectionIndexRef | None = None
    pipelines: list[str] = field(default_factory=list)


class CollectionIndexService:
    """Read and repoint a collection's index slots across its bindings."""

    def __init__(self, session: Session) -> None:
        """Bind the service to the request session."""
        self._session = session
        self._bindings = CollectionPipelineBindingRepository(session)
        self._pipelines = PipelineService(session)
        self._indexes = RegisteredIndexRepository(session)

    def read(
        self, user: models.User, collection: models.Collection
    ) -> CollectionIndexesRead:
        """Merge the bindings' index variables and literal targets."""
        drafts: dict[str, _SlotDraft] = {}
        targets: dict[tuple[IndexBackend, str, str], _TargetDraft] = {}
        for bound in self._bound_pipelines(user, collection):
            self._merge_binding(drafts, bound, user, collection)
            self._merge_targets(targets, bound, user)
        for draft in drafts.values():
            # The bind-time anchor falls back to the current index's own
            # width, so the slot advertises the same constraint it enforces.
            if (
                draft.expected_dimension is None
                and draft.vector_type == "dense"
                and draft.current is not None
            ):
                draft.expected_dimension = draft.current.dimension
        return CollectionIndexesRead(
            slots=[
                CollectionIndexSlot(
                    name=draft.name,
                    vector_type=draft.vector_type,
                    description=draft.description,
                    expected_dimension=draft.expected_dimension,
                    current=draft.current,
                    pipelines=draft.pipelines,
                )
                for draft in sorted(drafts.values(), key=lambda d: d.name)
            ],
            targets=[
                CollectionIndexTarget(
                    name=draft.name,
                    backend=draft.backend,
                    vector_type=draft.vector_type,
                    dimension=draft.dimension,
                    pipelines=draft.pipelines,
                )
                for draft in sorted(targets.values(), key=lambda d: (d.vector_type, d.name))
            ],
        )

    def _merge_targets(
        self,
        targets: dict[tuple[IndexBackend, str, str], _TargetDraft],
        bound: _BoundPipeline,
        user: models.User,
    ) -> None:
        """Fold one binding's literally-named indexes into the target drafts."""
        for identity in collect_index_identities(bound.definition, default_registry()):
            key = (identity.backend, identity.name, identity.vector_type)
            draft = targets.setdefault(
                key,
                _TargetDraft(
                    name=identity.name,
                    backend=identity.backend,
                    vector_type=identity.vector_type,
                    dimension=identity.dimension,
                ),
            )
            if draft.dimension is None:
                # A node states no width — the embedder beside it decides one —
                # so the registered index is what knows how wide the store is.
                row = self._indexes.find_by_identity(user.id, identity.backend, identity.name)
                draft.dimension = row.dimension if row is not None else None
            if bound.pipeline.name not in draft.pipelines:
                draft.pipelines.append(bound.pipeline.name)

    def _merge_binding(
        self,
        drafts: dict[str, _SlotDraft],
        bound: _BoundPipeline,
        user: models.User,
        collection: models.Collection,
    ) -> None:
        """Fold one binding's index variables into the slot drafts."""
        wanted = index_variable_vector_types(bound.definition)
        selected = selected_indexes(bound.definition, bound.binding.variable_values)
        for variable in index_variables(bound.definition):
            draft = drafts.setdefault(variable.name, _SlotDraft(name=variable.name))
            if bound.pipeline.name not in draft.pipelines:
                draft.pipelines.append(bound.pipeline.name)
            if draft.description is None and variable.description:
                draft.description = variable.description
            if wanted.get(variable.name) == "sparse":  # sparse wins, as at bind time
                draft.vector_type = "sparse"
            if draft.current is None:
                value = selected.get(variable.name)
                row = self._indexes.get(value.index_id, user.id) if value is not None else None
                if row is not None:
                    draft.current = _to_ref(row)
            if draft.expected_dimension is None:
                settings = resolve_pipeline_settings(
                    bound.definition,
                    collection,
                    default_registry(),
                    binding_values=bound.binding.variable_values,
                )
                draft.expected_dimension = settings.dimension

    def update(
        self,
        user: models.User,
        collection: models.Collection,
        values: dict[str, object],
    ) -> CollectionIndexesRead:
        """Apply slot selections to every binding that declares them.

        Every binding is excluded from the dimension anchor because they all
        move together here — the definition alone constrains the pick, which
        is what makes a deliberate collection-wide dimension change possible.
        """
        bound = self._bound_pipelines(user, collection)
        ensure_declared_somewhere([item.definition for item in bound], values)
        exclude = frozenset(item.binding.id for item in bound)
        for item in bound:
            subset = subset_declared(item.definition, values)
            if not subset:
                continue
            item.binding.variable_values = resolve_binding_values(
                self._session,
                user,
                collection,
                item.definition,
                {**item.binding.variable_values, **subset},
                exclude_binding_ids=exclude,
            )
            self._session.add(item.binding)
        self._session.commit()
        return self.read(user, collection)

    def _bound_pipelines(
        self, user: models.User, collection: models.Collection
    ) -> list[_BoundPipeline]:
        """Resolve each binding's pipeline and definition, skipping broken ones."""
        bound: list[_BoundPipeline] = []
        for binding in self._bindings.list_for_collection(collection.id):
            pipeline = self._pipelines.get_pipeline(binding.pipeline_id, user.id)
            if pipeline is None:
                continue
            try:
                definition = self._pipelines.get_definition(pipeline)
            except ValueError:
                continue
            bound.append(
                _BoundPipeline(binding=binding, pipeline=pipeline, definition=definition)
            )
        return bound


def _to_ref(row: models.RegisteredIndex) -> CollectionIndexRef:
    """Project a registry row onto the slot's wire shape."""
    return CollectionIndexRef(
        index_id=row.id,
        name=row.name,
        backend=row.backend,
        vector_type=row.vector_type,
        dimension=row.dimension,
        metric=row.metric,
    )
