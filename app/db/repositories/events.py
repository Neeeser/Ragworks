"""Repositories for the ingestion and query event tables."""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository
from app.schemas.evals_usage import EvalUsage


class QueryRepository(Repository):
    """Data access helpers for query events."""

    def add_event(self, event: models.QueryEvent) -> models.QueryEvent:
        """Persist a query event and return it."""
        return self._add(event)

    def get_for_user(self, query_event_id: UUID, user_id: UUID) -> models.QueryEvent | None:
        """Return a query event only when it exists and is owned by the user."""
        event = self.session.get(models.QueryEvent, query_event_id)
        if not event or event.user_id != user_id:
            return None
        return event


class IngestionEventRepository(Repository):
    """Data access helpers for ingestion events."""

    def usage_for_documents(self, document_ids: Iterable[UUID]) -> EvalUsage:
        """Sum the embedding usage the newest completion event records per document.

        The newest event is the one a caller that just ingested these
        documents produced, so re-ingesting a document counts its latest run
        rather than every attempt it has ever made.
        """
        ids = list(document_ids)
        if not ids:
            return EvalUsage()
        statement = (
            select(models.IngestionEvent)
            .where(
                col(models.IngestionEvent.document_id).in_(ids),
                col(models.IngestionEvent.status) == "success",
            )
            .order_by(col(models.IngestionEvent.created_at))
        )
        latest: dict[UUID, models.IngestionEvent] = {
            event.document_id: event for event in self.session.exec(statement).all()
        }
        total = EvalUsage()
        for event in latest.values():
            total = total.merged_with(_event_usage(event))
        return total


def _event_usage(event: models.IngestionEvent) -> EvalUsage:
    """Read the token counters one ingestion event recorded."""
    usage = event.details.get("usage")
    if not isinstance(usage, dict):
        return EvalUsage()
    return EvalUsage(
        prompt_tokens=_count(usage.get("prompt_tokens")),
        total_tokens=_count(usage.get("total_tokens")),
    )


def _count(value: object) -> int | None:
    """Coerce a stored counter into an int, or None when it is not one."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)
