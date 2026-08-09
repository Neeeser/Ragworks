"""Collection service: creation, updates, and prompts.

Owns the behavior the collection routes used to inline -- validating pipeline
selections and rendering/persisting a collection's system prompt. A collection
chooses which pipelines run, never what they do: node configuration lives in
the pipeline editor, so there is no per-collection config. Both pipeline
choices are required at creation and a collection keeps at least one of each
for its whole life, so every surface can resolve its bindings without ever
picking a pipeline on the user's behalf.
Resolution and validation failures surface as typed domain errors
(`app/services/errors.py`); the route translates them.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository
from app.prompting import catalog_for
from app.schemas.collections import (
    CollectionCreate,
    CollectionUpdate,
)
from app.schemas.enums import PromptContext
from app.schemas.prompts import PromptReference, PromptSelectionRead
from app.services.collection_tools import CollectionToolService
from app.services.errors import InvalidInputError
from app.services.pipeline_resolution import resolve_ingest_binding, resolve_primary_tool
from app.services.pipelines import PipelineService
from app.services.prompts import (
    apply_prompt_template,
    collection_tool_name,
    system_prompt_context,
)
from app.services.prompts.selection import (
    resolve_collection_prompt,
    selection_prompt_read,
    set_collection_prompt,
)
from app.services.tool_naming import ensure_unique_tool_names
from app.telemetry import record
from app.telemetry.events import CollectionCreated


class CollectionService:
    """Create, update, and render prompts for a user's collections."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.repo = CollectionRepository(session)
        self.pipelines = PipelineService(session)
        self.tools = CollectionToolService(session)

    def create(self, user: models.User, payload: CollectionCreate) -> models.Collection:
        """Create a collection with its bindings, cloning pipelines for overrides."""
        ingest = self._require_ingest_pipeline(payload.ingest_pipeline_id, user)
        tool_pipelines = [
            self._require_tool_pipeline(tool_id, user) for tool_id in payload.tool_pipeline_ids
        ]
        # Checked before any row is written: a batch of selections that
        # collide with each other must never leave a half-created collection
        # behind, and there is nothing to roll back if nothing was written.
        ensure_unique_tool_names(
            (pipeline, self.pipelines.interface_for(pipeline)) for pipeline in tool_pipelines
        )

        collection = models.Collection(
            id=uuid4(),
            user_id=user.id,
            name=payload.name,
            description=payload.description,
            extra_metadata=payload.metadata,
        )
        self.repo.add(collection)
        self.session.flush()
        # The same index choices reach every binding, so a new collection
        self.tools.set_ingest_pipeline(user, collection, ingest.id)
        for pipeline in tool_pipelines:
            self.tools.add_tool(user, collection, pipeline.id)
        self.session.commit()
        self.session.refresh(collection)
        record(CollectionCreated(user_id=user.id, collection_id=collection.id))
        return collection

    def update(
        self,
        collection: models.Collection,
        payload: CollectionUpdate,
        user: models.User,
    ) -> models.Collection:
        """Apply metadata/ingest-pipeline updates to a collection and persist them."""
        if payload.name is not None:
            collection.name = payload.name
        if payload.description is not None:
            collection.description = payload.description
        if payload.metadata is not None:
            collection.extra_metadata = {**collection.extra_metadata, **payload.metadata}
        if payload.ingest_pipeline_id is not None:
            self.tools.set_ingest_pipeline(user, collection, payload.ingest_pipeline_id)
        self.session.add(collection)
        self.session.commit()
        self.session.refresh(collection)
        return collection

    def prompt_read(
        self,
        collection: models.Collection,
        user: models.User,
    ) -> PromptSelectionRead:
        """Resolve the collection's tool prompt selection and render it."""
        resolved_ingest = resolve_ingest_binding(self.session, user, collection)
        resolved_tool = resolve_primary_tool(self.session, user, collection)
        body, reference = resolve_collection_prompt(self.session, collection)
        context = system_prompt_context(
            collection,
            user,
            ingestion_settings=resolved_ingest.settings,
            retrieval_settings=resolved_tool.settings,
            tool_name=collection_tool_name(collection.name),
        )
        return PromptSelectionRead(
            reference=reference,
            prompt=selection_prompt_read(self.session, user.id, reference),
            body=body,
            rendered=apply_prompt_template(body, context),
            context=context,
            variables=list(catalog_for(PromptContext.CHAT_TOOL).variables),
        )

    def update_prompt(
        self,
        collection: models.Collection,
        user: models.User,
        reference: PromptReference,
    ) -> PromptSelectionRead:
        """Point the collection's tool prompt at a library prompt."""
        set_collection_prompt(self.session, collection, reference)
        self.session.commit()
        self.session.refresh(collection)
        return self.prompt_read(collection, user)

    def _require_ingest_pipeline(self, pipeline_id: UUID, user: models.User) -> models.Pipeline:
        """Return a user-owned document-accepting pipeline or raise a 400."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline:
            raise InvalidInputError("Invalid ingestion pipeline selection.")
        if not self.pipelines.interface_for(pipeline).accepts_document:
            raise InvalidInputError("Invalid ingestion pipeline selection.")
        return pipeline

    def _require_tool_pipeline(self, pipeline_id: UUID, user: models.User) -> models.Pipeline:
        """Return a user-owned callable pipeline or raise a 400."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline:
            raise InvalidInputError("Invalid search tool selection.")
        if not self.pipelines.interface_for(pipeline).callable:
            raise InvalidInputError("Invalid search tool selection.")
        return pipeline

