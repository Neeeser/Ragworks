"""Startup migration collapsing per-collection index slots into the graph.

Definitions once carried binding-source index variables, and each collection
binding answered them. That made a definition mean different things for
different collections, so it is gone: a pipeline names the index it uses.

This migration folds the old shape back into the graph. For each stored
definition holding binding-source variables:

- every binding resolves to the same index (including the common case of no
  binding overriding anything at all) — the variable collapses to the
  literal it resolved to, and the definition is unchanged in behavior;
- bindings disagree — the definition collapses to its default and each
  divergent binding is repointed at a *copy* of the pipeline that names the
  index that binding had chosen. That is the supported way to make one graph
  into two, done mechanically here so nobody's corpus is silently detached
  from its data.

It works on raw stored JSON, never `PipelineDefinition`: `source: "binding"`
is no longer a valid `VariableSource`, so validating one of these rows would
raise before the migration could fix it.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import inspect, text
from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    PipelineRepository,
    PipelineVersionRepository,
)
from app.pipelines.variables import EXPRESSION_KEY

logger = logging.getLogger(__name__)

_BINDING_SOURCE = "binding"
_INDEX_TYPE = "index"
_BINDINGS_TABLE = "collection_pipeline_bindings"
_VALUES_COLUMN = "variable_values"


def collapse_index_slots(session: Session) -> int:
    """Collapse binding-source index variables; return the definitions changed.

    The local count is the migration's whole job: the stored rows, the
    overrides read from the doomed column, and the per-pipeline selections
    all have to be in hand at once to tell agreement from divergence.
    """
    versions = PipelineVersionRepository(session)
    pipelines = PipelineRepository(session)
    bindings_repo = CollectionPipelineBindingRepository(session)

    rows = [row for row in versions.list_all() if _slot_names(row.definition)]
    if not rows:
        _drop_values_column(session)
        return 0

    # Read the overrides straight from the column: the model no longer maps
    # it, and it is what says whether two collections had chosen differently.
    overrides = _stored_overrides(session)
    changed = 0
    for version in rows:
        pipeline = pipelines.get(version.pipeline_id)
        if pipeline is None:
            continue
        bindings = [
            binding
            for binding in bindings_repo.list_for_user(pipeline.user_id)
            if binding.pipeline_id == pipeline.id
        ]
        # Held before the rewrite: every copy is cut from the *slotted*
        # definition, and collapsing first would leave each one carrying the
        # default rather than the index its binding had chosen.
        original = version.definition
        selections = _selections_by_binding(original, bindings, overrides)
        winner = _default_selection(original)
        divergent = {
            binding_id: choice
            for binding_id, choice in selections.items()
            if choice != winner
        }
        version.definition = _collapsed(original, winner)
        session.add(version)
        changed += 1
        for binding_id, choice in divergent.items():
            _repoint_to_copy(session, pipeline, original, version.interface, binding_id, choice)
    session.commit()
    _drop_values_column(session)
    if changed:
        logger.info("Collapsed index slots in %d pipeline definitions.", changed)
    return changed


def _stored_overrides(session: Session) -> dict[UUID, dict[str, Any]]:
    """Read `{binding id: variable_values}` from the column, if it still exists."""
    if not _values_column_exists(session):
        return {}
    result = session.exec(  # type: ignore[call-overload]
        text(f"SELECT id, {_VALUES_COLUMN} FROM {_BINDINGS_TABLE}")
    )
    return {
        binding_id: values for binding_id, values in result if isinstance(values, dict)
    }


def _values_column_exists(session: Session) -> bool:
    """Return True while the dropped overrides column is still present."""
    bind = session.get_bind()
    columns = inspect(bind).get_columns(_BINDINGS_TABLE)
    return any(column["name"] == _VALUES_COLUMN for column in columns)


def _drop_values_column(session: Session) -> None:
    """Drop the overrides column once nothing reads it.

    Startup schema sync only ever *adds* columns, so leaving this one behind
    would leave a NOT NULL column the model no longer populates — every later
    binding insert would fail with a NotNullViolation, invisibly to a suite
    that builds the schema fresh from the current model.
    """
    if not _values_column_exists(session):
        return
    session.exec(  # type: ignore[call-overload]
        text(f"ALTER TABLE {_BINDINGS_TABLE} DROP COLUMN {_VALUES_COLUMN}")
    )
    session.commit()
    logger.info("Dropped %s.%s.", _BINDINGS_TABLE, _VALUES_COLUMN)


def _slot_names(definition: object) -> list[str]:
    """Return the binding-source index variable names a raw definition holds."""
    if not isinstance(definition, dict):
        return []
    variables = definition.get("variables")
    if not isinstance(variables, list):
        return []
    return [
        variable["name"]
        for variable in variables
        if isinstance(variable, dict)
        and variable.get("source") == _BINDING_SOURCE
        and variable.get("type") == _INDEX_TYPE
        and isinstance(variable.get("name"), str)
    ]


def _default_selection(definition: object) -> dict[str, dict[str, Any]]:
    """Return `{slot: index value}` from each variable's own default."""
    if not isinstance(definition, dict):
        return {}
    variables = definition.get("variables")
    if not isinstance(variables, list):
        return {}
    return {
        variable["name"]: variable["value"]
        for variable in variables
        if isinstance(variable, dict)
        and variable.get("source") == _BINDING_SOURCE
        and variable.get("type") == _INDEX_TYPE
        and isinstance(variable.get("name"), str)
        and isinstance(variable.get("value"), dict)
    }


def _selections_by_binding(
    definition: object,
    bindings: list[models.CollectionPipelineBinding],
    stored: dict[UUID, dict[str, Any]],
) -> dict[UUID, dict[str, dict[str, Any]]]:
    """Return what each binding actually resolved to, slot by slot."""
    defaults = _default_selection(definition)
    resolved: dict[UUID, dict[str, dict[str, Any]]] = {}
    for binding in bindings:
        overrides = stored.get(binding.id, {})
        choice = dict(defaults)
        for slot in defaults:
            supplied = overrides.get(slot)
            if isinstance(supplied, dict):
                choice[slot] = supplied
        resolved[binding.id] = choice
    return resolved


def _collapsed(
    definition: object,
    selection: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Return the definition with its slots replaced by literal identity."""
    if not isinstance(definition, dict):
        return {}
    collapsed = dict(definition)
    slots = set(_slot_names(definition))
    collapsed["variables"] = [
        variable
        for variable in definition.get("variables", [])
        if not (isinstance(variable, dict) and variable.get("name") in slots)
    ]
    collapsed["nodes"] = [
        _collapsed_node(node, selection) for node in definition.get("nodes", [])
    ]
    return collapsed


def _collapsed_node(node: object, selection: dict[str, dict[str, Any]]) -> Any:
    """Replace one node's slot expressions with the literals they resolved to."""
    if not isinstance(node, dict):
        return node
    config = node.get("config")
    if not isinstance(config, dict):
        return node
    updated = dict(config)
    for key, value in config.items():
        if not isinstance(value, dict) or EXPRESSION_KEY not in value:
            continue
        source = value[EXPRESSION_KEY]
        if not isinstance(source, str):
            continue
        slot, _, member = source.partition(".")
        chosen = selection.get(slot)
        if chosen is None or member not in ("name", "backend"):
            continue
        replacement = chosen.get(member)
        if isinstance(replacement, str):
            updated[key] = replacement
    return {**node, "config": updated}


def _repoint_to_copy(
    session: Session,
    pipeline: models.Pipeline,
    definition: object,
    interface: object,
    binding_id: UUID,
    selection: dict[str, dict[str, Any]],
) -> None:
    """Point one divergent binding at a copy naming the index it had chosen.

    Written directly rather than through `PipelineService`: the service
    validates, and a definition mid-migration may not validate yet.
    """
    binding = session.get(models.CollectionPipelineBinding, binding_id)
    if binding is None:
        return
    copy = models.Pipeline(
        id=uuid4(),
        user_id=pipeline.user_id,
        name=f"{pipeline.name} (copy)",
        description=pipeline.description,
        current_version=1,
    )
    session.add(copy)
    session.flush()
    session.add(
        models.PipelineVersion(
            pipeline_id=copy.id,
            version=1,
            definition=_collapsed(definition, selection),
            interface=interface,
            change_summary=(
                f"Copied from '{pipeline.name}' so this collection keeps its own index."
            ),
            created_by=pipeline.user_id,
        )
    )
    binding.pipeline_id = copy.id
    session.add(binding)
    logger.info(
        "Repointed binding %s onto a copy of pipeline %s to preserve its index.",
        binding_id,
        pipeline.id,
    )
