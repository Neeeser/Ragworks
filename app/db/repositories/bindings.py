"""Repository for collection pipeline bindings."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import asc
from sqlalchemy import delete as sa_delete
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository


class CollectionPipelineBindingRepository(Repository):
    """Data access helpers for collection pipeline bindings."""

    def list_for_collection(
        self,
        collection_id: UUID,
        *,
        role: models.BindingRole | None = None,
    ) -> list[models.CollectionPipelineBinding]:
        """List a collection's bindings in stable position order."""
        statement = select(models.CollectionPipelineBinding).where(
            col(models.CollectionPipelineBinding.collection_id) == collection_id,
        )
        if role is not None:
            statement = statement.where(
                col(models.CollectionPipelineBinding.role) == role,
            )
        statement = statement.order_by(
            asc(col(models.CollectionPipelineBinding.position)),
            asc(col(models.CollectionPipelineBinding.created_at)),
        )
        return list(self.session.exec(statement).all())

    def get(self, binding_id: UUID) -> models.CollectionPipelineBinding | None:
        """Return a binding by id (ownership is checked via its collection)."""
        return self.session.get(models.CollectionPipelineBinding, binding_id)

    def get_for_collection(
        self,
        collection_id: UUID,
        binding_id: UUID,
    ) -> models.CollectionPipelineBinding | None:
        """Return a binding by id scoped to one collection."""
        binding = self.get(binding_id)
        if binding is None or binding.collection_id != collection_id:
            return None
        return binding

    def pipeline_is_bound(self, pipeline_id: UUID) -> bool:
        """Return True when any collection binds the pipeline (in any role)."""
        statement = (
            select(col(models.CollectionPipelineBinding.id))
            .where(col(models.CollectionPipelineBinding.pipeline_id) == pipeline_id)
            .limit(1)
        )
        return self.session.exec(statement).first() is not None

    def add(
        self, binding: models.CollectionPipelineBinding
    ) -> models.CollectionPipelineBinding:
        """Persist a new binding and return it."""
        return self._add(binding)

    def delete(self, binding: models.CollectionPipelineBinding) -> None:
        """Delete a binding row; the caller flushes/commits."""
        self.session.delete(binding)

    def delete_for_collection(self, collection_id: UUID) -> None:
        """Delete every binding of a collection (deletion cascade)."""
        self.session.execute(
            sa_delete(models.CollectionPipelineBinding).where(
                col(models.CollectionPipelineBinding.collection_id) == collection_id,
            )
        )
