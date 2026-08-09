"""Helpers for building collections in tests the way the app builds them.

A collection is created with an ingest binding and at least one tool binding
and keeps them for its whole life — nothing binds a pipeline on its behalf
later. A test that inserts the row directly therefore binds them here, and a
test that posts to the API names them in the body.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.db import models

#: The names `install_scaffolded_pipelines` gives the pair it installs.
SCAFFOLD_INGEST_NAME = "Hybrid Ingestion"
SCAFFOLD_SEARCH_NAME = "Hybrid Search"


def scaffolded_pair(
    session: Session, user: models.User
) -> tuple[models.Pipeline, models.Pipeline]:
    """The user's installed ingest/search pair, by template slug."""
    from app.services.pipelines import (
        DEFAULT_INGEST_SLUG,
        DEFAULT_SEARCH_SLUG,
        PipelineService,
    )

    service = PipelineService(session)
    ingest = service.get_by_template_slug(user.id, DEFAULT_INGEST_SLUG)
    search = service.get_by_template_slug(user.id, DEFAULT_SEARCH_SLUG)
    if ingest is None or search is None:
        raise AssertionError(
            "This user holds no scaffolded pipelines — call "
            "`install_scaffolded_pipelines` before building a collection."
        )
    return ingest, search


def bind_scaffolds(
    session: Session, user: models.User, collection: models.Collection
) -> models.Collection:
    """Bind the user's scaffolded pair onto a collection built row-first."""
    from app.db.repositories import CollectionPipelineBindingRepository

    ingest, search = scaffolded_pair(session, user)
    bindings = CollectionPipelineBindingRepository(session)
    bindings.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=ingest.id,
            role=models.BindingRole.INGEST,
        )
    )
    bindings.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=search.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()
    session.refresh(collection)
    return collection


def collection_create(
    session: Session,
    user: models.User,
    name: str = "Collection",
    description: str = "",
) -> Any:
    """A `CollectionCreate` naming the user's scaffolded pair."""
    from app.schemas.collections import CollectionCreate

    ingest, search = scaffolded_pair(session, user)
    return CollectionCreate(
        name=name,
        description=description,
        ingest_pipeline_id=ingest.id,
        tool_pipeline_ids=[search.id],
    )


def collection_payload(
    session: Session,
    user: models.User,
    name: str = "Collection",
    description: str = "",
) -> dict[str, Any]:
    """A `POST /api/collections` body naming the user's scaffolded pair."""
    ingest, search = scaffolded_pair(session, user)
    return {
        "name": name,
        "description": description,
        "ingest_pipeline_id": str(ingest.id),
        "tool_pipeline_ids": [str(search.id)],
    }


def api_collection_payload(
    client: Any, name: str = "Collection", description: str = ""
) -> dict[str, Any]:
    """The same body, resolved over the API the way a client would.

    Route tests hold a `TestClient` rather than the session, so the pair is
    found by the names `install_scaffolded_pipelines` gives it. Matching by
    name rather than taking the first of each listing keeps the choice
    deterministic in a test that creates pipelines of its own first.
    """
    listed = client.get("/api/pipelines").json()
    by_name = {pipeline["name"]: pipeline["id"] for pipeline in listed}
    missing = {SCAFFOLD_INGEST_NAME, SCAFFOLD_SEARCH_NAME} - by_name.keys()
    if missing:
        raise AssertionError(f"This account holds no scaffolded pipelines named {sorted(missing)}.")
    return {
        "name": name,
        "description": description,
        "ingest_pipeline_id": by_name[SCAFFOLD_INGEST_NAME],
        "tool_pipeline_ids": [by_name[SCAFFOLD_SEARCH_NAME]],
    }
