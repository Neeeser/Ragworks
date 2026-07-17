"""Collection service: creation (with pipeline overrides), updates, and prompts.

Owns the behavior the collection routes used to inline -- validating pipeline
selections, cloning a base pipeline with per-node config overrides, and
rendering/persisting a collection's system prompt. Resolution and validation
failures surface as typed domain errors (`app/services/errors.py`); the route
translates them.
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
from app.services.errors import InvalidInputError
from app.services.pipeline_resolution import (
    resolve_ingestion_pipeline,
    resolve_retrieval_pipeline,
)
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

    def create(self, user: models.User, payload: CollectionCreate) -> models.Collection:
        """Create a collection, cloning pipelines when overrides are supplied."""
        defaults = self.pipelines.ensure_default_pipelines(user)
        ingestion = self._require_pipeline(
            payload.ingestion_pipeline_id or defaults.ingestion.id,
            models.PipelineKind.INGESTION,
            user,
        )
        retrieval = self._require_pipeline(
            payload.retrieval_pipeline_id or defaults.retrieval.id,
            models.PipelineKind.RETRIEVAL,
            user,
        )

        overrides = payload.pipeline_overrides
        if overrides and overrides.ingestion:
            ingestion = self._clone_pipeline_with_overrides(
                user=user,
                name=payload.name,
                kind=models.PipelineKind.INGESTION,
                base=ingestion,
                overrides=overrides.ingestion,
            )
        if overrides and overrides.retrieval:
            retrieval = self._clone_pipeline_with_overrides(
                user=user,
                name=payload.name,
                kind=models.PipelineKind.RETRIEVAL,
                base=retrieval,
                overrides=overrides.retrieval,
            )

        collection = models.Collection(
            id=uuid4(),
            user_id=user.id,
            name=payload.name,
            description=payload.description,
            ingestion_pipeline_id=ingestion.id,
            retrieval_pipeline_id=retrieval.id,
            extra_metadata=payload.metadata,
        )
        self.repo.add(collection)
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
        """Apply metadata/pipeline updates to a collection and persist them."""
        if payload.name is not None:
            collection.name = payload.name
        if payload.description is not None:
            collection.description = payload.description
        if payload.metadata is not None:
            collection.extra_metadata = {**collection.extra_metadata, **payload.metadata}
        if payload.ingestion_pipeline_id is not None:
            self._require_pipeline(
                payload.ingestion_pipeline_id, models.PipelineKind.INGESTION, user
            )
            collection.ingestion_pipeline_id = payload.ingestion_pipeline_id
        if payload.retrieval_pipeline_id is not None:
            self._require_pipeline(
                payload.retrieval_pipeline_id, models.PipelineKind.RETRIEVAL, user
            )
            collection.retrieval_pipeline_id = payload.retrieval_pipeline_id
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
        resolved_ingestion = resolve_ingestion_pipeline(self.session, user, collection)
        resolved_retrieval = resolve_retrieval_pipeline(self.session, user, collection)
        template = get_system_prompt_template(collection)
        context = system_prompt_context(
            collection,
            user,
            ingestion_settings=resolved_ingestion.settings,
            retrieval_settings=resolved_retrieval.settings,
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

    def _require_pipeline(
        self,
        pipeline_id: UUID,
        kind: models.PipelineKind,
        user: models.User,
    ) -> models.Pipeline:
        """Return a user-owned pipeline of the given kind or raise a 400."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline or pipeline.kind != kind:
            raise InvalidInputError(f"Invalid {kind.value} pipeline selection.")
        return pipeline

    def _clone_pipeline_with_overrides(
        self,
        *,
        user: models.User,
        name: str,
        kind: models.PipelineKind,
        base: models.Pipeline,
        overrides: list[PipelineNodeOverride],
    ) -> models.Pipeline:
        """Clone `base` into a collection-specific pipeline with node overrides."""
        override_map = {override.node_id: override.config for override in overrides}
        definition = self.pipelines.get_definition(base).model_copy(deep=True)
        for node in definition.nodes:
            if node.id in override_map:
                node.config = {**node.config, **override_map[node.id]}
        label = "Ingestion" if kind == models.PipelineKind.INGESTION else "Retrieval"
        return self.pipelines.create_pipeline(
            user=user,
            name=f"{name} {label} Pipeline",
            kind=kind,
            definition=definition,
            change_summary=f"Customized {label.lower()} pipeline for collection.",
            is_default=False,
        )
