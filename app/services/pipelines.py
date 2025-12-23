# pylint: disable=duplicate-code
"""Pipeline services for managing definitions and defaults."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import delete as sa_delete, or_
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import PipelineRepository, PipelineVersionRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.models import PipelineDefinition


@dataclass
class DefaultPipelines:
    """Container for default ingestion and retrieval pipelines."""

    ingestion: models.Pipeline
    retrieval: models.Pipeline


class PipelineService:
    """Service for pipeline CRUD and version management."""

    def __init__(self, session: Session) -> None:
        """Initialize the pipeline service."""
        self.session = session
        self._pipelines = PipelineRepository(session)
        self._versions = PipelineVersionRepository(session)

    def list_pipelines(
        self,
        user_id: UUID,
        *,
        kind: Optional[models.PipelineKind] = None,
    ) -> Iterable[models.Pipeline]:
        """Return pipelines for the given user."""
        return self._pipelines.list_for_user(user_id, kind=kind)

    def get_pipeline(self, pipeline_id: UUID, user_id: UUID) -> Optional[models.Pipeline]:
        """Return a pipeline for a user."""
        return self._pipelines.get(pipeline_id, user_id=user_id)

    def get_current_version(self, pipeline: models.Pipeline) -> models.PipelineVersion:
        """Return the current version for a pipeline."""
        version = self._versions.get_by_version(pipeline.id, pipeline.current_version)
        if not version:
            raise ValueError("Pipeline has no current version.")
        return version

    def get_definition(self, pipeline: models.Pipeline) -> PipelineDefinition:
        """Return the current definition for a pipeline."""
        version = self.get_current_version(pipeline)
        return PipelineDefinition.model_validate(version.definition)

    def create_pipeline(  # pylint: disable=too-many-arguments
        self,
        *,
        user: models.User,
        name: str,
        kind: models.PipelineKind,
        definition: PipelineDefinition,
        description: Optional[str] = None,
        change_summary: Optional[str] = None,
        is_default: bool = False,
    ) -> models.Pipeline:
        """Create a pipeline and its first version."""
        pipeline = models.Pipeline(
            user_id=user.id,
            name=name,
            description=description,
            kind=kind,
            current_version=1,
            is_default=is_default,
        )
        self._pipelines.add(pipeline)
        version = models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=definition.model_dump(mode="json"),
            change_summary=change_summary,
            created_by=user.id,
        )
        self._versions.add(version)
        return pipeline

    def update_pipeline(  # pylint: disable=too-many-arguments
        self,
        *,
        pipeline: models.Pipeline,
        definition: Optional[PipelineDefinition] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        change_summary: Optional[str] = None,
        actor_id: Optional[UUID] = None,
    ) -> models.Pipeline:
        """Update pipeline metadata and optionally create a new version."""
        if name is not None:
            pipeline.name = name
        if description is not None:
            pipeline.description = description
        if definition is not None:
            next_version = pipeline.current_version + 1
            version = models.PipelineVersion(
                pipeline_id=pipeline.id,
                version=next_version,
                definition=definition.model_dump(mode="json"),
                change_summary=change_summary,
                created_by=actor_id,
            )
            self._versions.add(version)
            pipeline.current_version = next_version
        self.session.add(pipeline)
        return pipeline

    def list_versions(self, pipeline: models.Pipeline) -> Iterable[models.PipelineVersion]:
        """List versions for a pipeline."""
        return self._versions.list_for_pipeline(pipeline.id)

    def pipeline_in_use(self, pipeline_id: UUID) -> bool:
        """Return True if any collection references the pipeline."""
        statement = (
            select(models.Collection.id)
            .where(
                or_(
                    models.Collection.ingestion_pipeline_id == pipeline_id,
                    models.Collection.retrieval_pipeline_id == pipeline_id,
                )
            )
            .limit(1)
        )
        return self.session.exec(statement).first() is not None

    def delete_pipeline(self, pipeline: models.Pipeline) -> None:
        """Delete a pipeline and its versions."""
        self.session.exec(
            sa_delete(models.PipelineVersion).where(
                models.PipelineVersion.pipeline_id == pipeline.id,
            )
        )
        self.session.delete(pipeline)
        self.session.flush()

    def activate_version(self, pipeline: models.Pipeline, version: int) -> models.Pipeline:
        """Set the pipeline's active version."""
        target = self._versions.get_by_version(pipeline.id, version)
        if not target:
            raise ValueError("Requested pipeline version does not exist.")
        pipeline.current_version = version
        self.session.add(pipeline)
        return pipeline

    def ensure_default_pipelines(self, user: models.User) -> DefaultPipelines:
        """Ensure the default ingestion/retrieval pipelines exist for a user."""
        ingestion = self._pipelines.get_default(user.id, models.PipelineKind.INGESTION)
        retrieval = self._pipelines.get_default(user.id, models.PipelineKind.RETRIEVAL)

        if ingestion is None:
            ingestion = self.create_pipeline(
                user=user,
                name="Default Ingestion Pipeline",
                description="Baseline ingestion pipeline for uploads.",
                kind=models.PipelineKind.INGESTION,
                definition=build_default_ingestion_pipeline(),
                change_summary="Initial default ingestion pipeline.",
                is_default=True,
            )
        if retrieval is None:
            retrieval = self.create_pipeline(
                user=user,
                name="Default Retrieval Pipeline",
                description="Baseline retrieval pipeline for queries.",
                kind=models.PipelineKind.RETRIEVAL,
                definition=build_default_retrieval_pipeline(),
                change_summary="Initial default retrieval pipeline.",
                is_default=True,
            )
        return DefaultPipelines(ingestion=ingestion, retrieval=retrieval)

    def ensure_collection_pipelines(
        self,
        collection: models.Collection,
        defaults: DefaultPipelines,
    ) -> models.Collection:
        """Attach default pipelines to a collection when missing."""
        if collection.ingestion_pipeline_id is None:
            collection.ingestion_pipeline_id = defaults.ingestion.id
        if collection.retrieval_pipeline_id is None:
            collection.retrieval_pipeline_id = defaults.retrieval.id
        self.session.add(collection)
        return collection


def backfill_default_pipelines(session: Session) -> None:
    """Ensure all users and collections have default pipelines assigned."""
    service = PipelineService(session)
    users = session.exec(select(models.User)).all()
    for user in users:
        defaults = service.ensure_default_pipelines(user)
        collections = session.exec(
            select(models.Collection).where(models.Collection.user_id == user.id)
        ).all()
        for collection in collections:
            service.ensure_collection_pipelines(collection, defaults)
