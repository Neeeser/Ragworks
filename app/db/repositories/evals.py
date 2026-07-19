"""Repositories for eval datasets and evaluation runs."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository


class EvalDatasetRepository(Repository):
    """Data access for eval datasets and their corpus/queries/qrels."""

    def add(self, dataset: models.EvalDataset) -> models.EvalDataset:
        """Persist a dataset row and return it."""
        return self._add(dataset)

    def get_for_user(self, dataset_id: UUID, user_id: UUID) -> models.EvalDataset | None:
        """Return a dataset only when it exists and is owned by the user."""
        dataset = self.session.get(models.EvalDataset, dataset_id)
        if not dataset or dataset.user_id != user_id:
            return None
        return dataset

    def list_for_user(self, user_id: UUID) -> list[models.EvalDataset]:
        """Return every dataset owned by the user, newest first."""
        statement = (
            select(models.EvalDataset)
            .where(col(models.EvalDataset.user_id) == user_id)
            .order_by(col(models.EvalDataset.created_at).desc())
        )
        return list(self.session.exec(statement).all())

    def add_documents(self, documents: Sequence[models.EvalDatasetDocument]) -> None:
        """Bulk-insert corpus documents for a dataset."""
        self.session.add_all(list(documents))
        self.session.flush()

    def add_queries(self, queries: Sequence[models.EvalDatasetQuery]) -> None:
        """Bulk-insert queries for a dataset."""
        self.session.add_all(list(queries))
        self.session.flush()

    def add_judgments(self, judgments: Sequence[models.EvalRelevanceJudgment]) -> None:
        """Bulk-insert relevance judgments (qrels) for a dataset."""
        self.session.add_all(list(judgments))
        self.session.flush()

    def list_queries(self, dataset_id: UUID) -> list[models.EvalDatasetQuery]:
        """Return every query in a dataset."""
        statement = select(models.EvalDatasetQuery).where(
            col(models.EvalDatasetQuery.dataset_id) == dataset_id
        )
        return list(self.session.exec(statement).all())

    def list_judgments(self, dataset_id: UUID) -> list[models.EvalRelevanceJudgment]:
        """Return every relevance judgment in a dataset."""
        statement = select(models.EvalRelevanceJudgment).where(
            col(models.EvalRelevanceJudgment.dataset_id) == dataset_id
        )
        return list(self.session.exec(statement).all())

    def list_documents(self, dataset_id: UUID) -> list[models.EvalDatasetDocument]:
        """Return every corpus document in a dataset."""
        statement = select(models.EvalDatasetDocument).where(
            col(models.EvalDatasetDocument.dataset_id) == dataset_id
        )
        return list(self.session.exec(statement).all())

    def get_documents_by_external_ids(
        self, dataset_id: UUID, external_ids: Sequence[str]
    ) -> list[models.EvalDatasetDocument]:
        """Return the corpus documents whose external ids are in the given set."""
        if not external_ids:
            return []
        statement = select(models.EvalDatasetDocument).where(
            col(models.EvalDatasetDocument.dataset_id) == dataset_id,
            col(models.EvalDatasetDocument.external_doc_id).in_(list(external_ids)),
        )
        return list(self.session.exec(statement).all())

    def delete(self, dataset: models.EvalDataset) -> None:
        """Delete a dataset and all of its corpus/queries/qrels rows."""
        dataset_id = dataset.id
        for model in (
            models.EvalDatasetDocument,
            models.EvalDatasetQuery,
            models.EvalRelevanceJudgment,
        ):
            for row in self.session.exec(
                select(model).where(col(model.dataset_id) == dataset_id)
            ).all():
                self.session.delete(row)
        self.session.delete(dataset)
        self.session.flush()


class EvalRunRepository(Repository):
    """Data access for eval runs and their per-query items."""

    def add(self, run: models.EvalRun) -> models.EvalRun:
        """Persist a run row and return it."""
        return self._add(run)

    def get_for_user(self, run_id: UUID, user_id: UUID) -> models.EvalRun | None:
        """Return a run only when it exists and is owned by the user."""
        run = self.session.get(models.EvalRun, run_id)
        if not run or run.user_id != user_id:
            return None
        return run

    def list_for_user(self, user_id: UUID) -> list[models.EvalRun]:
        """Return every run owned by the user, newest first."""
        statement = (
            select(models.EvalRun)
            .where(col(models.EvalRun.user_id) == user_id)
            .order_by(col(models.EvalRun.created_at).desc())
        )
        return list(self.session.exec(statement).all())

    def add_item(self, item: models.EvalRunItem) -> models.EvalRunItem:
        """Persist one evaluated-query item and return it."""
        return self._add(item)

    def list_items(self, run_id: UUID) -> list[models.EvalRunItem]:
        """Return every persisted item for a run."""
        statement = select(models.EvalRunItem).where(col(models.EvalRunItem.run_id) == run_id)
        return list(self.session.exec(statement).all())
