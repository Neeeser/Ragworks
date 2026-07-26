"""Resolving, auto-filling, and validating a binding's variable values.

Binding a pipeline to a collection asks one question per binding-source
variable: which index (or value) does *this* collection use? This module owns
the answer, so every entry point — the tools API, the ingest rebind, the
migration, the scaffolder — produces the same thing.

Two behaviors matter:

- **Auto-fill** — an index slot left unset takes the collection's existing
  index of the same vector type. Attaching a second tool to a collection that
  already ingests somewhere should not make the user re-pick the index they
  are obviously targeting.
- **Rejection with names** — a chosen index whose backend cannot run the
  graph is refused *naming the nodes*, because "incompatible backend" alone
  leaves the user guessing which node to remove.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import EllipsisType
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository, RegisteredIndexRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.expressions import IndexValue
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_static_definition
from app.pipelines.settings import collection_scope, resolve_pipeline_settings
from app.pipelines.variables import (
    BindingContext,
    VariableSource,
    VariableType,
    VariableValueError,
    coerce_literal,
)
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError
from app.services.index_compatibility import (
    incompatible_nodes,
    index_variable_vector_types,
)
from app.services.index_registry import index_variables
from app.services.pipelines import PipelineService


def index_value_for(index: models.RegisteredIndex) -> dict[str, str]:
    """Project a registered index onto the wire shape a binding stores."""
    return {
        "index_id": str(index.id),
        "backend": IndexBackend(index.backend).value,
        "name": index.name,
    }


def collection_indexes(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    exclude_binding_ids: frozenset[UUID] = frozenset(),
) -> dict[str, models.RegisteredIndex]:
    """Return the collection's current indexes, keyed by vector type.

    Derived from the collection's existing bindings rather than stored: a
    collection does not *own* indexes, it uses whichever ones its pipelines
    point at, and deriving keeps that answer true after every rebind.
    `exclude_binding_ids` drops bindings from the derivation — a binding being
    repointed must not anchor its own validation.
    """
    indexes = RegisteredIndexRepository(session)
    bindings = CollectionPipelineBindingRepository(session).list_for_collection(collection.id)
    pipelines = PipelineService(session)
    found: dict[str, models.RegisteredIndex] = {}
    for binding in bindings:
        if binding.id in exclude_binding_ids:
            continue
        pipeline = pipelines.get_pipeline(binding.pipeline_id, user.id)
        if pipeline is None:
            continue
        try:
            definition = pipelines.get_definition(pipeline)
        except ValueError:
            continue
        settings = resolve_pipeline_settings(
            definition,
            collection,
            default_registry(),
            binding_values=binding.variable_values,
        )
        for target in settings.index_targets:
            if target.vector_type in found:
                continue
            row = indexes.find_by_identity(user.id, target.backend, target.index_name)
            if row is not None:
                found[target.vector_type] = row
    return found


def resolve_binding_values(
    session: Session,
    user: models.User,
    collection: models.Collection,
    definition: PipelineDefinition,
    supplied: Mapping[str, object] | None = None,
    *,
    exclude_binding_ids: frozenset[UUID] = frozenset(),
) -> dict[str, object]:
    """Return the values to store on a binding: supplied, auto-filled, defaults.

    Raises `InvalidInputError` when a supplied index is unknown, not owned by
    the user, of the wrong vector type or dimension, or on a backend the
    graph's nodes cannot run. `exclude_binding_ids` names the binding(s) being
    rewritten in this operation, so the dimension check anchors on the
    collection's *other* bindings — a coordinated move of every binding at
    once excludes them all and is anchored by the definition alone.
    """
    values = dict(supplied or {})
    _reject_unknown(definition, values)
    _validate_indexes(session, user, collection, definition, values, exclude_binding_ids)
    _autofill_indexes(session, user, collection, definition, values)
    _reject_incompatible(collection, definition, values)
    return values


def declared_binding_names(definition: PipelineDefinition) -> set[str]:
    """Return the names of the definition's binding-source variables."""
    return {
        variable.name
        for variable in definition.variables
        if variable.source is VariableSource.BINDING
    }


def subset_declared(
    definition: PipelineDefinition, values: Mapping[str, object]
) -> dict[str, object]:
    """Return only the entries naming this definition's binding variables.

    Collection-level entry points share one value set across every binding,
    so a slot only the *other* pipeline declares is expected here, not an
    error — `ensure_declared_somewhere` is what still catches typos.
    """
    declared = declared_binding_names(definition)
    return {name: value for name, value in values.items() if name in declared}


def ensure_declared_somewhere(
    definitions: Iterable[PipelineDefinition], values: Mapping[str, object]
) -> None:
    """Reject values no involved pipeline declares.

    The per-binding subset silently drops foreign names, so without this a
    typo'd slot name would vanish instead of failing — and the index the user
    thought they chose would quietly stay unset.
    """
    declared: set[str] = set()
    for definition in definitions:
        declared |= declared_binding_names(definition)
    unknown = sorted(set(values) - declared)
    if unknown:
        raise InvalidInputError(
            f"No selected pipeline has a binding variable named: {', '.join(unknown)}."
        )


def _reject_unknown(definition: PipelineDefinition, values: dict[str, object]) -> None:
    """Reject values naming variables the pipeline does not expose."""
    unknown = sorted(set(values) - declared_binding_names(definition))
    if unknown:
        raise InvalidInputError(
            f"This pipeline has no binding variable named: {', '.join(unknown)}."
        )


def _validate_indexes(  # pylint: disable=too-many-arguments,too-many-positional-arguments
    session: Session,
    user: models.User,
    collection: models.Collection,
    definition: PipelineDefinition,
    values: dict[str, object],
    exclude_binding_ids: frozenset[UUID],
) -> None:
    """Replace supplied index selections with the registry's own identity.

    The client sends an index id; the stored value is rebuilt from the row, so
    a caller cannot pin a name or backend that disagrees with the registry.
    """
    indexes = RegisteredIndexRepository(session)
    wanted = index_variable_vector_types(definition)
    anchor: tuple[int, str] | None | EllipsisType = ...
    for variable in index_variables(definition):
        supplied = values.get(variable.name)
        if supplied is None:
            continue
        index_id = _index_id(variable.name, supplied)
        row = indexes.get(index_id, user.id)
        if row is None:
            raise InvalidInputError(
                f"Variable '{variable.name}': index not found. Register the index first."
            )
        expected = wanted.get(variable.name)
        if expected is not None and row.vector_type != expected:
            # A lexical node reading a dense index (or the reverse) returns
            # nothing rather than failing, so the mismatch is worth naming
            # here instead of surfacing as an empty result set later.
            raise InvalidInputError(
                f"Variable '{variable.name}' needs a {expected} index, but "
                f"'{row.name}' is {row.vector_type}."
            )
        if row.vector_type == "dense" and row.dimension is not None:
            if anchor is ...:  # computed once, and only when a dense pick needs it
                anchor = _dimension_anchor(
                    session, user, collection, definition, exclude_binding_ids
                )
            if anchor is not None and row.dimension != anchor[0]:
                dimension, source = anchor
                # A width mismatch never errors at query time — the dense
                # branch just returns nothing — so it is rejected here, the
                # only moment the mistake is visible.
                raise InvalidInputError(
                    f"Variable '{variable.name}': index '{row.name}' stores "
                    f"{row.dimension}-dimensional vectors, but {source} uses "
                    f"{dimension}. Repoint the collection's indexes together "
                    "to change dimensions."
                )
        values[variable.name] = index_value_for(row)


def _dimension_anchor(
    session: Session,
    user: models.User,
    collection: models.Collection,
    definition: PipelineDefinition,
    exclude_binding_ids: frozenset[UUID],
) -> tuple[int, str] | None:
    """Return the dense dimension a selection must match, with its source.

    The definition's own stated dimension wins; the default pipelines state
    none (the model's native width is only known at run time), so the anchor
    falls back to the collection's current dense index — ingest must write
    where retrieval reads. No anchor means no constraint to enforce.
    """
    settings = resolve_pipeline_settings(definition, collection, default_registry())
    if settings.dimension is not None:
        return settings.dimension, "this pipeline"
    existing = collection_indexes(
        session, user, collection, exclude_binding_ids=exclude_binding_ids
    ).get("dense")
    if existing is not None and existing.dimension is not None:
        return existing.dimension, f"the collection's index '{existing.name}'"
    return None


def _index_id(variable_name: str, supplied: object) -> UUID:
    """Extract the index id from a supplied selection."""
    try:
        value = coerce_literal(VariableType.INDEX, supplied)
    except VariableValueError as error:
        raise InvalidInputError(f"Variable '{variable_name}': {error}.") from error
    if not isinstance(value, IndexValue):  # pragma: no cover - coerce_literal guarantees it
        raise InvalidInputError(f"Variable '{variable_name}': expected an index.")
    return value.index_id


def _autofill_indexes(
    session: Session,
    user: models.User,
    collection: models.Collection,
    definition: PipelineDefinition,
    values: dict[str, object],
) -> None:
    """Fill unset index slots from the collection's existing indexes."""
    missing = [
        variable for variable in index_variables(definition) if variable.name not in values
    ]
    if not missing:
        return
    existing = collection_indexes(session, user, collection)
    if not existing:
        return
    vector_types = index_variable_vector_types(definition)
    for variable in missing:
        row = existing.get(vector_types.get(variable.name, "dense"))
        if row is not None:
            values[variable.name] = index_value_for(row)


def _reject_incompatible(
    collection: models.Collection,
    definition: PipelineDefinition,
    values: dict[str, object],
) -> None:
    """Refuse a selection whose backend cannot run the graph, naming the nodes."""
    resolved = resolve_static_definition(
        definition,
        binding=BindingContext(collection=collection_scope(collection), values=values),
    )
    findings = incompatible_nodes(resolved, default_registry())
    if not findings:
        return
    detail = " ".join(finding.message for finding in findings)
    raise InvalidInputError(
        f"The selected index is on a backend this pipeline cannot use. {detail}"
    )
