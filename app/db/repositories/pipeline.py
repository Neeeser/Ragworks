"""Repositories for pipelines, their versions, and trace runs."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import asc, desc
from sqlalchemy import delete as sa_delete
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository, user_scoped


class PipelineRepository(Repository):
    """Data access helpers for pipelines."""

    def list_for_user(
        self,
        user_id: UUID,
        *,
        kind: models.PipelineKind | None = None,
    ) -> list[models.Pipeline]:
        """List pipelines for a user, optionally filtered by kind."""
        statement = select(models.Pipeline).where(models.Pipeline.user_id == user_id)
        if kind:
            statement = statement.where(models.Pipeline.kind == kind)
        return list(self.session.exec(statement).all())

    def get(
        self,
        pipeline_id: UUID,
        user_id: UUID | None = None,
    ) -> models.Pipeline | None:
        """Return a pipeline by id, optionally scoped to a user."""
        statement = select(models.Pipeline).where(models.Pipeline.id == pipeline_id)
        statement = user_scoped(statement, models.Pipeline, user_id)
        return self.session.exec(statement).first()

    def get_default(
        self,
        user_id: UUID,
        kind: models.PipelineKind,
    ) -> models.Pipeline | None:
        """Return the default pipeline for a user and kind."""
        statement = select(models.Pipeline).where(
            col(models.Pipeline.user_id) == user_id,
            col(models.Pipeline.kind) == kind,
            col(models.Pipeline.is_default).is_(True),
        )
        return self.session.exec(statement).first()

    def add(self, pipeline: models.Pipeline) -> models.Pipeline:
        """Persist a new pipeline and return it."""
        return self._add(pipeline)


class PipelineVersionRepository(Repository):
    """Data access helpers for pipeline versions."""

    def list_for_pipeline(self, pipeline_id: UUID) -> list[models.PipelineVersion]:
        """List versions for a pipeline in descending order."""
        statement = (
            select(models.PipelineVersion)
            .where(models.PipelineVersion.pipeline_id == pipeline_id)
            .order_by(desc(col(models.PipelineVersion.version)))
        )
        return list(self.session.exec(statement).all())

    def list_all(self) -> list[models.PipelineVersion]:
        """List every stored version (startup definition migrations)."""
        return list(self.session.exec(select(models.PipelineVersion)).all())

    def get_by_version(
        self,
        pipeline_id: UUID,
        version: int,
    ) -> models.PipelineVersion | None:
        """Return a specific version for a pipeline."""
        statement = select(models.PipelineVersion).where(
            col(models.PipelineVersion.pipeline_id) == pipeline_id,
            col(models.PipelineVersion.version) == version,
        )
        return self.session.exec(statement).first()

    def get_by_id(self, version_id: UUID) -> models.PipelineVersion | None:
        """Return a pipeline version by its own id, regardless of pipeline."""
        return self.session.get(models.PipelineVersion, version_id)

    def delete_for_pipeline(self, pipeline_id: UUID) -> None:
        """Delete every version belonging to a pipeline; the caller flushes."""
        self.session.execute(
            sa_delete(models.PipelineVersion).where(
                col(models.PipelineVersion.pipeline_id) == pipeline_id,
            )
        )

    def add(self, version: models.PipelineVersion) -> models.PipelineVersion:
        """Persist a pipeline version and return it."""
        return self._add(version)


class PipelineRunRepository(Repository):
    """Data access helpers for pipeline trace runs."""

    def get(
        self,
        run_id: UUID,
        user_id: UUID | None = None,
    ) -> models.PipelineRun | None:
        """Return a pipeline run by id, optionally scoped to a user."""
        statement = select(models.PipelineRun).where(models.PipelineRun.id == run_id)
        statement = user_scoped(statement, models.PipelineRun, user_id)
        return self.session.exec(statement).first()

    def list_node_runs(self, run_id: UUID) -> list[models.PipelineNodeRun]:
        """List node run records for a pipeline run."""
        statement = (
            select(models.PipelineNodeRun)
            .where(models.PipelineNodeRun.run_id == run_id)
            .order_by(asc(col(models.PipelineNodeRun.sequence_index)))
        )
        return list(self.session.exec(statement).all())

    def list_node_io(self, run_id: UUID) -> list[models.PipelineNodeIO]:
        """List node input/output records for a pipeline run."""
        statement = (
            select(models.PipelineNodeIO)
            .where(models.PipelineNodeIO.run_id == run_id)
            .order_by(asc(col(models.PipelineNodeIO.created_at)))
        )
        return list(self.session.exec(statement).all())
