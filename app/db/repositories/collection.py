"""Repository for collections: ownership-scoped lookups and row lifecycle.

Stats/history aggregation lives in `collection_stats.py`.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_
from sqlalchemy import update as sa_update
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository, user_scoped
from app.schemas.enums import CollectionPurpose


class CollectionRepository(Repository):
    """Data access helpers for collections."""

    def list_for_user(self, user_id: UUID) -> list[models.Collection]:
        """List a user's own collections, excluding system-purposed ones.

        Eval collections (`system_purpose = "eval"`) are provisioned scaffolding
        managed from the Evals section; they never appear in the user-facing
        collection surfaces this method feeds.
        """
        statement = select(models.Collection).where(
            col(models.Collection.user_id) == user_id,
            col(models.Collection.system_purpose).is_(None),
        )
        return list(self.session.exec(statement).all())

    def list_eval_for_user(self, user_id: UUID) -> list[models.Collection]:
        """List the user's eval-owned collections for the Evals management page."""
        statement = select(models.Collection).where(
            col(models.Collection.user_id) == user_id,
            col(models.Collection.system_purpose) == CollectionPurpose.EVAL.value,
        )
        return list(self.session.exec(statement).all())

    def list_by_ids(
        self,
        user_id: UUID,
        ids: Sequence[UUID],
    ) -> list[models.Collection]:
        """List a user's collections whose ids are in the given set."""
        if not ids:
            return []
        statement = select(models.Collection).where(
            col(models.Collection.user_id) == user_id,
            col(models.Collection.id).in_(ids),
        )
        return list(self.session.exec(statement).all())

    def get(
        self,
        collection_id: UUID,
        user_id: UUID | None = None,
    ) -> models.Collection | None:
        """Return a collection by id, optionally scoped to a user."""
        statement = select(models.Collection).where(models.Collection.id == collection_id)
        statement = user_scoped(statement, models.Collection, user_id)
        return self.session.exec(statement).first()

    def add(self, collection: models.Collection) -> models.Collection:
        """Persist a new collection and return it."""
        return self._add(collection)

    def purge_related_rows(self, collection_id: UUID) -> None:
        """Delete every row owned by a collection and detach its chat sessions.

        This is the DB half of the collection-deletion cascade (the vector and
        file purges live in `CollectionDeletionService`). Order matters only in
        that pipeline-run children are removed before their parent runs; chat
        sessions are *detached* (`collection_id -> NULL`), never deleted, so a
        user's chat history outlives the collection it referenced.
        """
        execute = self.session.execute
        execute(
            sa_delete(models.DocumentChunkRecord).where(
                col(models.DocumentChunkRecord.collection_id) == collection_id,
            )
        )
        execute(
            sa_delete(models.IngestionEvent).where(
                col(models.IngestionEvent.collection_id) == collection_id,
            )
        )
        execute(
            sa_delete(models.QueryEvent).where(
                col(models.QueryEvent.collection_id) == collection_id,
            )
        )
        execute(
            sa_delete(models.Document).where(
                col(models.Document.collection_id) == collection_id,
            )
        )
        # After documents (documents.file_id references file_nodes). The
        # self-referential parent_id FK is safe in one statement: NO ACTION
        # constraints are checked at statement end, when parents and children
        # are gone together.
        execute(
            sa_delete(models.FileNode).where(
                col(models.FileNode.collection_id) == collection_id,
            )
        )
        run_ids = list(
            self.session.exec(
                select(col(models.PipelineRun.id)).where(
                    col(models.PipelineRun.collection_id) == collection_id,
                )
            ).all()
        )
        if run_ids:
            execute(
                sa_delete(models.PipelineNodeIO).where(
                    col(models.PipelineNodeIO.run_id).in_(run_ids),
                )
            )
            execute(
                sa_delete(models.PipelineNodeRun).where(
                    col(models.PipelineNodeRun.run_id).in_(run_ids),
                )
            )
            execute(
                sa_delete(models.PipelineRun).where(
                    col(models.PipelineRun.id).in_(run_ids),
                )
            )
        execute(
            sa_delete(models.ChatSessionCollection).where(
                col(models.ChatSessionCollection.collection_id) == collection_id,
            )
        )
        execute(
            sa_update(models.ChatSession)
            .where(col(models.ChatSession.collection_id) == collection_id)
            .values(collection_id=None)
        )

    def delete(self, collection: models.Collection) -> None:
        """Delete a collection row (call `purge_related_rows` first)."""
        self.session.delete(collection)

    def references_pipeline(self, pipeline_id: UUID) -> bool:
        """Return True when any collection uses the pipeline for ingestion or retrieval."""
        statement = (
            select(col(models.Collection.id))
            .where(
                or_(
                    col(models.Collection.ingestion_pipeline_id) == pipeline_id,
                    col(models.Collection.retrieval_pipeline_id) == pipeline_id,
                )
            )
            .limit(1)
        )
        return self.session.exec(statement).first() is not None

    def count_by_user(self) -> dict[UUID, int]:
        """Return a mapping of user id -> number of collections they own."""
        statement = select(
            models.Collection.user_id,
            func.count(),  # pylint: disable=not-callable
        ).group_by(col(models.Collection.user_id))
        return {user_id: count for user_id, count in self.session.exec(statement).all()}
