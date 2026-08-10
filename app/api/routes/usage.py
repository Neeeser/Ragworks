"""Usage API routes: the caller's own ledger summary and drill-down list.

`build_query` is shared with the admin rollup (`app/api/routes/admin.py`),
which passes a `user_id` of its own — here it is always the caller's, so a
per-user route cannot serve another account's rows.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.schemas.enums import UsageBucket, UsageGroupBy, UsageKind, UsageSurface
from app.schemas.usage import UsageEventPage, UsageQuery, UsageSummaryRead
from app.services.errors import ServiceError
from app.services.usage import UsageReadService, resolve_range

router = APIRouter(prefix="/api/usage", tags=["usage"])


def build_query(  # noqa: PLR0913 - one query parameter per argument
    *,
    user_id: UUID | None,
    start: datetime | None,
    end: datetime | None,
    kind: UsageKind | None = None,
    surface: UsageSurface | None = None,
    connection_id: UUID | None = None,
    model: str | None = None,
) -> UsageQuery:
    """Assemble the filter set one usage read applies."""
    resolved_start, resolved_end = resolve_range(start, end)
    return UsageQuery(
        start=resolved_start,
        end=resolved_end,
        user_id=user_id,
        kind=kind,
        surface=surface,
        connection_id=connection_id,
        model=model,
    )


@router.get("/summary", response_model=UsageSummaryRead)
def get_usage_summary(
    start: datetime | None = None,
    end: datetime | None = None,
    group_by: UsageGroupBy = UsageGroupBy.MODEL,
    bucket: UsageBucket = UsageBucket.DAY,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UsageSummaryRead:
    """Summarize the caller's own usage over a range."""
    try:
        query = build_query(user_id=current_user.id, start=start, end=end)
        return UsageReadService(session).summary(query, group_by=group_by, bucket=bucket)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/events", response_model=UsageEventPage)
def list_usage_events(  # noqa: PLR0913 - one query parameter per argument
    start: datetime | None = None,
    end: datetime | None = None,
    kind: UsageKind | None = None,
    surface: UsageSurface | None = None,
    connection_id: UUID | None = None,
    model: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UsageEventPage:
    """List the caller's own ledger rows, newest first."""
    try:
        query = build_query(
            user_id=current_user.id,
            start=start,
            end=end,
            kind=kind,
            surface=surface,
            connection_id=connection_id,
            model=model,
        )
        return UsageReadService(session).events(query, limit=limit, offset=offset)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
