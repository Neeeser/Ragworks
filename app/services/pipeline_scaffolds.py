"""The first-run setup wizard's scaffold identity, and one repair step.

`template_slug` marks the pipelines first-run setup installs, so re-running
the wizard updates them instead of leaving a second copy behind. The slug
values are stored data and cannot change: rewriting one hides every pipeline
already carrying it, and the wizard installs duplicates beside them.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    PipelineRepository,
    UserRepository,
)

#: Slugs marking the pipelines first-run setup installs.
DEFAULT_INGEST_SLUG = "default-ingest"
DEFAULT_SEARCH_SLUG = "default-search"
#: Optional aggregate tools the wizard offers (see `app/pipelines/tool_defaults.py`).
DEFAULT_COUNT_SLUG = "default-count"
DEFAULT_FACET_SLUG = "default-facet"


def backfill_collection_bindings(session: Session) -> None:
    """Bind the setup scaffolds onto collections left unbound by older data.

    A collection is created with both bindings and keeps them, so this only
    reaches rows written before that held. It never creates a pipeline: a user
    with no scaffolds has nothing this step could bind, and their collection's
    next run names the missing binding rather than silently running a graph
    nobody chose.
    """
    bindings = CollectionPipelineBindingRepository(session)
    collections = CollectionRepository(session)
    pipelines = PipelineRepository(session)
    for user in UserRepository(session).list_all():
        ingest = pipelines.get_by_template_slug(user.id, DEFAULT_INGEST_SLUG)
        search = pipelines.get_by_template_slug(user.id, DEFAULT_SEARCH_SLUG)
        if ingest is None and search is None:
            continue
        for collection in collections.list_for_user(user.id):
            existing = bindings.list_for_collection(collection.id)
            roles = {binding.role for binding in existing}
            if ingest is not None and models.BindingRole.INGEST not in roles:
                bindings.add(
                    models.CollectionPipelineBinding(
                        collection_id=collection.id,
                        pipeline_id=ingest.id,
                        role=models.BindingRole.INGEST,
                    )
                )
            if search is not None and models.BindingRole.TOOL not in roles:
                bindings.add(
                    models.CollectionPipelineBinding(
                        collection_id=collection.id,
                        pipeline_id=search.id,
                        role=models.BindingRole.TOOL,
                        is_primary=True,
                    )
                )
