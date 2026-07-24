"""Collection service: creation (with pipeline overrides), updates, and prompts.

Owns the behavior the collection routes used to inline -- validating pipeline
selections, cloning a base pipeline with per-node config overrides, and
rendering/persisting a collection's system prompt. Bindings are created
eagerly at collection creation (a collection is born with its ingest binding
and primary search tool), so read-only surfaces never need to scaffold.
Resolution and validation failures surface as typed domain errors
(`app/services/errors.py`); the route translates them.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository
from app.schemas.collections import (
    CollectionCreate,
    CollectionPromptRead,
    CollectionUpdate,
    PipelineNodeOverride,
)
from app.services.collection_tools import CollectionToolService
from app.services.errors import InvalidInputError
from app.services.pipeline_resolution import resolve_ingest_binding, resolve_primary_tool
from app.services.pipelines import PipelineService
from app.services.prompts import (
    apply_prompt_template,
    collection_tool_name,
    get_system_prompt_template,
    is_collection_prompt_custom,
    prompt_variables_payload,
    system_prompt_context,
    with_system_prompt_template,
)
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
        defaults = self.pipelines.ensure_default_pipelines(user)
        ingest = self._require_ingest_pipeline(
            payload.ingest_pipeline_id or defaults.ingestion.id, user
        )
        tool_ids = (
            list(payload.tool_pipeline_ids)
            if payload.tool_pipeline_ids
            else [defaults.retrieval.id]
        )
        tool_pipelines = [self._require_tool_pipeline(tool_id, user) for tool_id in tool_ids]

        overrides = payload.pipeline_overrides
        if overrides and overrides.ingestion:
            ingest = self._clone_pipeline_with_overrides(
                user=user,
                name=payload.name,
                label="Ingestion",
                base=ingest,
                overrides=overrides.ingestion,
            )
        if overrides and overrides.retrieval and tool_pipelines:
            tool_pipelines[0] = self._clone_pipeline_with_overrides(
                user=user,
                name=payload.name,
                label="Retrieval",
                base=tool_pipelines[0],
                overrides=overrides.retrieval,
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
    ) -> CollectionPromptRead:
        """Render the collection's system prompt template and its live context."""
        resolved_ingest = resolve_ingest_binding(self.session, user, collection)
        resolved_tool = resolve_primary_tool(self.session, user, collection)
        template = get_system_prompt_template(collection)
        context = system_prompt_context(
            collection,
            user,
            ingestion_settings=resolved_ingest.settings,
            retrieval_settings=resolved_tool.settings,
            tool_name=collection_tool_name(collection.name),
        )
        return CollectionPromptRead(
            template=template,
            rendered=apply_prompt_template(template, context),
            context=context,
            variables=prompt_variables_payload(scope="collection"),
            is_custom=is_collection_prompt_custom(collection),
        )

    def update_prompt(
        self,
        collection: models.Collection,
        user: models.User,
        template: str | None,
    ) -> CollectionPromptRead:
        """Persist a new system prompt template and return the rendered result."""
        template_value = (template or "").replace("\r\n", "\n")
        # Reassignment, never in-place mutation: JSON columns aren't change-tracked.
        collection.extra_metadata = with_system_prompt_template(
            collection.extra_metadata,
            template_value,
        )
        self.session.add(collection)
        self.session.commit()
        self.session.refresh(collection)
        return self.prompt_read(collection, user)

    def _require_ingest_pipeline(
        self, pipeline_id: UUID, user: models.User
    ) -> models.Pipeline:
        """Return a user-owned document-accepting pipeline or raise a 400."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline:
            raise InvalidInputError("Invalid ingestion pipeline selection.")
        if not self.pipelines.interface_for(pipeline).accepts_document:
            raise InvalidInputError("Invalid ingestion pipeline selection.")
        return pipeline

    def _require_tool_pipeline(
        self, pipeline_id: UUID, user: models.User
    ) -> models.Pipeline:
        """Return a user-owned callable pipeline or raise a 400."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline:
            raise InvalidInputError("Invalid retrieval pipeline selection.")
        if not self.pipelines.interface_for(pipeline).callable:
            raise InvalidInputError("Invalid retrieval pipeline selection.")
        return pipeline

    def _clone_pipeline_with_overrides(
        self,
        *,
        user: models.User,
        name: str,
        label: str,
        base: models.Pipeline,
        overrides: list[PipelineNodeOverride],
    ) -> models.Pipeline:
        """Clone `base` into a collection-specific pipeline with node overrides."""
        override_map = {override.node_id: override.config for override in overrides}
        definition = self.pipelines.get_definition(base).model_copy(deep=True)
        for node in definition.nodes:
            if node.id in override_map:
                node.config = {**node.config, **override_map[node.id]}
        return self.pipelines.create_pipeline(
            user=user,
            name=f"{name} {label} Pipeline",
            definition=definition,
            change_summary=f"Customized {label.lower()} pipeline for collection.",
        )
