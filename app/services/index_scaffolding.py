"""Registering the indexes a scaffolded pipeline names.

Every path that *generates* a pipeline — the setup wizard, default
scaffolding, the startup migration — routes its definition through here, so
every index a definition names exists as a `RegisteredIndex` row. A path that
skipped it would leave its indexes invisible to the index registry's "used
by" list and unselectable everywhere a picker offers the registered set.

Registration is all this does: the definition comes back unchanged. Making an
index a first-class entity and hoisting the choice out of the graph are
separate decisions, and fusing them makes every scaffolded pipeline expose a
slot its author never asked for.

Deliberately separate from `index_registry`: that module answers questions
about existing bindings (and so depends on `PipelineService`), while this one
only reads a definition — keeping it here is what stops pipeline scaffolding
and the pipeline service from importing each other.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.index_identity import collect_index_identities
from app.pipelines.registry import default_registry


def register_definition_indexes(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
) -> PipelineDefinition:
    """Register every index the definition names and return it unchanged.

    `get_or_create` is what makes two pipelines naming one index share a
    single row — the whole point of the entity, and what lets the registry
    answer "who uses this?".
    """
    indexes = RegisteredIndexRepository(session)
    for identity in collect_index_identities(definition, default_registry()):
        indexes.get_or_create(
            user.id,
            identity.backend,
            identity.name,
            vector_type=identity.vector_type,
            dimension=identity.dimension if identity.vector_type == "dense" else None,
            metric=identity.metric if identity.vector_type == "dense" else None,
        )
    return definition
