"""Registering the indexes a scaffolded pipeline names.

Every path that *generates* a pipeline — the setup wizard, default
scaffolding, the startup migration — routes its definition through here, so a
scaffolded pipeline ships in the same index-variable shape as a migrated one.
A path that skipped it would produce the one kind of pipeline a collection can
never repoint, and its indexes would be invisible to the Index Manager's
"used by" list.

Deliberately separate from `index_registry`: that module answers questions
about existing bindings (and so depends on `PipelineService`), while this one
only shapes a definition — keeping it here is what stops pipeline scaffolding
and the pipeline service from importing each other.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.index_variables import rewrite_index_identity
from app.pipelines.registry import default_registry


def register_definition_indexes(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
) -> PipelineDefinition:
    """Register the indexes a definition names and point it at them.

    Every path that scaffolds a pipeline (the setup wizard, default
    scaffolding, the migration) calls this, so a scaffolded pipeline is always
    in the same shape as a migrated one. A path that skipped it would produce
    the one pipeline a user cannot repoint per collection, and its indexes
    would be invisible to the Index Manager's "used by" list.
    """
    rewritten = rewrite_index_identity(definition, default_registry())
    if not rewritten.changed:
        return definition
    indexes = RegisteredIndexRepository(session)
    ids = {
        variable: indexes.get_or_create(
            user.id,
            identity.backend,
            identity.name,
            vector_type=identity.vector_type,
            dimension=identity.dimension if identity.vector_type == "dense" else None,
            metric=identity.metric if identity.vector_type == "dense" else None,
        ).id
        for variable, identity in rewritten.identities.items()
    }
    return rewrite_index_identity(
        definition, default_registry(), index_ids=ids
    ).definition
