"""Dataset query review: the optional human-curation surface.

Listing, editing, and deleting individual dataset queries. Never required —
a generated dataset is runnable as-is — but a human can inspect what the
model produced, fix a question's wording, or remove a bad one. Gold labels
are read-only here: editing text never touches qrels, and deleting a query
removes its qrels with it.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import EvalDatasetRepository
from app.schemas.enums import EvalQuestionType
from app.schemas.evals_generation import (
    EvalDatasetQueriesPage,
    EvalDatasetQueryGold,
    EvalDatasetQueryRead,
)
from app.services.errors import InvalidInputError, NotFoundError


class DatasetQueryService:
    """Review surface over one dataset's queries."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request session."""
        self.session = session
        self.datasets = EvalDatasetRepository(session)

    def list_queries(
        self, user: models.User, dataset_id: UUID, *, offset: int, limit: int
    ) -> EvalDatasetQueriesPage:
        """Page a dataset's queries with their gold references and metadata."""
        dataset = self._get_dataset(user, dataset_id)
        queries, total = self.datasets.page_queries(
            dataset.id, offset=offset, limit=limit
        )
        gold_map = self._gold_for(dataset.id, [q.external_query_id for q in queries])
        items = [_to_query_read(query, gold_map) for query in queries]
        return EvalDatasetQueriesPage(total=total, items=items)

    def update_query_text(
        self, user: models.User, dataset_id: UUID, query_id: UUID, text: str
    ) -> EvalDatasetQueryRead:
        """Edit one query's text; its gold labels are unchanged."""
        dataset = self._get_dataset(user, dataset_id)
        query = self._get_query(dataset.id, query_id)
        query.text = text.strip()
        self.session.add(query)
        self.session.commit()
        self.session.refresh(query)
        gold_map = self._gold_for(dataset.id, [query.external_query_id])
        return _to_query_read(query, gold_map)

    def delete_query(self, user: models.User, dataset_id: UUID, query_id: UUID) -> None:
        """Delete one query and its qrels; the last query is not deletable."""
        dataset = self._get_dataset(user, dataset_id)
        query = self._get_query(dataset.id, query_id)
        if self.datasets.count_queries(dataset.id) <= 1:
            raise InvalidInputError(
                "A dataset needs at least one query. Delete the dataset instead."
            )
        self.datasets.delete_query_with_judgments(query)
        dataset.num_queries = self.datasets.count_queries(dataset.id)
        self.session.add(dataset)
        self.session.commit()

    def _get_dataset(self, user: models.User, dataset_id: UUID) -> models.EvalDataset:
        """Return a user-owned dataset or raise NotFoundError."""
        dataset = self.datasets.get_for_user(dataset_id, user.id)
        if dataset is None:
            raise NotFoundError("Eval dataset not found.")
        return dataset

    def _get_query(self, dataset_id: UUID, query_id: UUID) -> models.EvalDatasetQuery:
        """Return a dataset's query or raise NotFoundError."""
        query = self.datasets.get_query(dataset_id, query_id)
        if query is None:
            raise NotFoundError("Dataset query not found.")
        return query

    def _gold_for(
        self, dataset_id: UUID, external_query_ids: list[str]
    ) -> dict[str, list[EvalDatasetQueryGold]]:
        """Positive gold references per query external id, with display titles."""
        judgments = self.datasets.judgments_for_queries(dataset_id, external_query_ids)
        positive = [j for j in judgments if j.relevance >= 1]
        titles = self.datasets.get_titles_by_external_ids(
            dataset_id, sorted({j.doc_external_id for j in positive})
        )
        gold_map: dict[str, list[EvalDatasetQueryGold]] = {}
        for judgment in positive:
            gold_map.setdefault(judgment.query_external_id, []).append(
                EvalDatasetQueryGold(
                    external_doc_id=judgment.doc_external_id,
                    title=titles.get(judgment.doc_external_id),
                )
            )
        return gold_map


def _to_query_read(
    query: models.EvalDatasetQuery,
    gold_map: dict[str, list[EvalDatasetQueryGold]],
) -> EvalDatasetQueryRead:
    """Shape one query row (and its generation metadata) for the wire."""
    metadata = query.query_metadata or {}
    return EvalDatasetQueryRead(
        id=query.id,
        external_query_id=query.external_query_id,
        text=query.text,
        question_type=_question_type(metadata.get("question_type")),
        scores=_scores(metadata.get("scores")),
        quote=_optional_str(metadata.get("quote")),
        gold=gold_map.get(query.external_query_id, []),
    )


def _optional_str(value: object) -> str | None:
    """The value when it is a string, otherwise None."""
    return value if isinstance(value, str) else None


def _question_type(value: object) -> EvalQuestionType | None:
    """A known question type, or None for absent/unknown values."""
    try:
        return EvalQuestionType(value)
    except ValueError:
        return None


def _scores(value: object) -> dict[str, int] | None:
    """The critique score map when it is one, otherwise None."""
    if not isinstance(value, dict):
        return None
    scores = {
        str(key): int(entry)
        for key, entry in value.items()
        if isinstance(entry, (int, float)) and not isinstance(entry, bool)
    }
    return scores or None
