"""Repository for the append-only usage ledger: appends and aggregation.

Every aggregate is cut per `(group, unit)` — a token count and a read-unit
count measure different things, so a query that summed them would report a
number nobody billed.

Dollars are the one figure that crosses units, and an aggregate reports one
only when every counted event in it carries a price: `_priced_cost` yields
NULL as soon as one unpriced row with a nonzero quantity falls inside the
group. A row priced at `0.0` is a real price, and an unpriced row that
measured nothing suppresses nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Label, and_, case, func, null, select
from sqlalchemy.orm import Mapped
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import SQLModel, col

from app.db import models
from app.db.repositories.base import Repository
from app.schemas.enums import UsageBucket, UsageGroupBy, UsageKind, UsageSurface, UsageUnit
from app.schemas.usage import UsageQuery


@dataclass(frozen=True)
class UsageGroupAggregate:
    """One `(group key, unit)` aggregate over a range."""

    key: str | None
    label: str | None
    unit: str
    quantity: int
    cost_usd: float | None
    event_count: int


@dataclass(frozen=True)
class UsageSeriesAggregate:
    """One `(time bucket, kind, unit)` aggregate over a range."""

    bucket_start: datetime
    kind: str
    unit: str
    quantity: int
    cost_usd: float | None


@dataclass(frozen=True)
class UsageUnitAggregate:
    """One unit's range total."""

    unit: str
    quantity: int
    cost_usd: float | None
    event_count: int


def _priced_cost() -> Label[float | None]:
    """Sum costs, or NULL when any counted event in the group is unpriced."""
    event = models.UsageEvent
    unpriced = func.bool_or(and_(col(event.cost_usd).is_(None), col(event.quantity) != 0))
    return case(
        (unpriced, null()),
        else_=func.coalesce(func.sum(col(event.cost_usd)), 0.0),
    ).label("cost_usd")


def _group_key() -> dict[UsageGroupBy, Mapped[Any]]:
    """The column each group_by cuts on."""
    event = models.UsageEvent
    return {
        UsageGroupBy.MODEL: col(event.model),
        UsageGroupBy.KIND: col(event.kind),
        UsageGroupBy.SURFACE: col(event.surface),
        UsageGroupBy.CONNECTION: col(event.connection_id),
        UsageGroupBy.USER: col(event.user_id),
    }


@dataclass(frozen=True)
class _LabelSource:
    """Where a group key's human-readable name is read from."""

    table: type[SQLModel]
    column: Mapped[Any]
    onclause: ColumnElement[bool]


def _label_source(group_by: UsageGroupBy) -> _LabelSource | None:
    """The table a group's label comes from, or None when the key is the name."""
    event = models.UsageEvent
    if group_by is UsageGroupBy.CONNECTION:
        return _LabelSource(
            table=models.ProviderConnection,
            column=col(models.ProviderConnection.label),
            onclause=col(models.ProviderConnection.id) == col(event.connection_id),
        )
    if group_by is UsageGroupBy.USER:
        return _LabelSource(
            table=models.User,
            column=col(models.User.email),
            onclause=col(models.User.id) == col(event.user_id),
        )
    return None


class UsageEventRepository(Repository):
    """Data access for the append-only usage_events table."""

    def add_event(  # noqa: PLR0913 - one column per argument; the row is the contract
        self,
        *,
        user_id: UUID,
        connection_id: UUID | None,
        provider: str,
        model: str,
        kind: UsageKind,
        surface: UsageSurface,
        quantity: int,
        unit: UsageUnit,
        context_type: str | None = None,
        context_id: UUID | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        cost_usd: float | None = None,
    ) -> models.UsageEvent:
        """Append one usage row (flushed, not committed)."""
        return self._add(
            models.UsageEvent(
                user_id=user_id,
                connection_id=connection_id,
                provider=provider,
                model=model,
                kind=kind.value,
                surface=surface.value,
                context_type=context_type,
                context_id=context_id,
                quantity=quantity,
                unit=unit.value,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
            )
        )

    def _filters(self, query: UsageQuery) -> list[ColumnElement[bool]]:
        """The WHERE terms every read of the ledger shares."""
        event = models.UsageEvent
        clauses: list[ColumnElement[bool]] = [
            col(event.created_at) >= query.start,
            col(event.created_at) < query.end,
        ]
        if query.user_id is not None:
            clauses.append(col(event.user_id) == query.user_id)
        if query.kind is not None:
            clauses.append(col(event.kind) == query.kind.value)
        if query.surface is not None:
            clauses.append(col(event.surface) == query.surface.value)
        if query.connection_id is not None:
            clauses.append(col(event.connection_id) == query.connection_id)
        if query.model is not None:
            clauses.append(col(event.model) == query.model)
        return clauses

    def grouped_totals(
        self, query: UsageQuery, group_by: UsageGroupBy
    ) -> list[UsageGroupAggregate]:
        """Aggregate the range per `(group key, unit)`, largest quantity first."""
        event = models.UsageEvent
        key = _group_key()[group_by]
        source = _label_source(group_by)
        # A group whose key is already its own name selects a NULL label, and
        # that literal stays out of the GROUP BY: Postgres reads a bare NULL
        # there as an ordinal reference and rejects the statement.
        label = null().label("label") if source is None else source.column
        quantity = func.coalesce(func.sum(col(event.quantity)), 0)
        grouping = (
            [key, col(event.unit)] if source is None else [key, source.column, col(event.unit)]
        )
        statement = select(
            key, label, col(event.unit), quantity, _priced_cost(), func.count()
        ).select_from(event)
        if source is not None:
            statement = statement.outerjoin(source.table, source.onclause)
        statement = (
            statement.where(*self._filters(query)).group_by(*grouping).order_by(quantity.desc())
        )
        return [
            UsageGroupAggregate(
                key=None if row_key is None else str(row_key),
                label=row_label,
                unit=unit,
                quantity=int(row_quantity),
                cost_usd=None if cost is None else float(cost),
                event_count=int(count),
            )
            for row_key, row_label, unit, row_quantity, cost, count in self.session.execute(
                statement
            )
        ]

    def bucketed_series(self, query: UsageQuery, bucket: UsageBucket) -> list[UsageSeriesAggregate]:
        """Aggregate the range per `(time bucket, kind, unit)`, oldest first."""
        event = models.UsageEvent
        bucket_start = func.date_trunc(bucket.value, col(event.created_at)).label("bucket_start")
        statement = (
            select(
                bucket_start,
                col(event.kind),
                col(event.unit),
                func.coalesce(func.sum(col(event.quantity)), 0),
                _priced_cost(),
            )
            .where(*self._filters(query))
            .group_by(bucket_start, col(event.kind), col(event.unit))
            .order_by(bucket_start)
        )
        return [
            UsageSeriesAggregate(
                bucket_start=start,
                kind=kind,
                unit=unit,
                quantity=int(quantity),
                cost_usd=None if cost is None else float(cost),
            )
            for start, kind, unit, quantity, cost in self.session.execute(statement)
        ]

    def unit_totals(self, query: UsageQuery) -> list[UsageUnitAggregate]:
        """The range's total per unit."""
        event = models.UsageEvent
        statement = (
            select(
                col(event.unit),
                func.coalesce(func.sum(col(event.quantity)), 0),
                _priced_cost(),
                func.count(),
            )
            .where(*self._filters(query))
            .group_by(col(event.unit))
            .order_by(col(event.unit))
        )
        return [
            UsageUnitAggregate(
                unit=unit,
                quantity=int(quantity),
                cost_usd=None if cost is None else float(cost),
                event_count=int(count),
            )
            for unit, quantity, cost, count in self.session.execute(statement)
        ]

    def total_cost(self, query: UsageQuery) -> float | None:
        """The range's whole-range cost, or None when any counted event is unpriced."""
        statement = select(_priced_cost()).where(*self._filters(query))
        cost = self.session.execute(statement).scalar_one()
        return None if cost is None else float(cost)

    def list_events(self, query: UsageQuery, *, limit: int, offset: int) -> list[models.UsageEvent]:
        """Return one page of matching rows, newest first."""
        event = models.UsageEvent
        statement = (
            select(event)
            .where(*self._filters(query))
            .order_by(col(event.created_at).desc(), col(event.id))
            .limit(limit)
            .offset(offset)
        )
        return list(self.session.execute(statement).scalars().all())

    def count_events(self, query: UsageQuery) -> int:
        """How many rows the filters match across every page."""
        statement = select(func.count()).select_from(models.UsageEvent).where(*self._filters(query))
        return int(self.session.execute(statement).scalar_one())
