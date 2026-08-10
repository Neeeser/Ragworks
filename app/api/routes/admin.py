"""Admin API routes: user management.

The router itself carries the ``require_admin`` dependency so every route in
it — and every route added to it later — is admin-gated by construction.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.dependencies import get_session, require_admin
from app.api.routes.usage import build_query
from app.api.routes.utils import to_http_exception
from app.db import models
from app.observability import events as log_events
from app.observability import get_logger
from app.observability.export import build_diagnostics_bundle
from app.schemas.admin import (
    AdminUsageSummary,
    AdminUsageTimeseries,
    AdminUserRead,
    AdminUserUpdate,
    AppConfigUpdate,
    ConfigFieldRead,
)
from app.schemas.enums import UsageBucket, UsageGroupBy, UsageKind, UsageSurface
from app.schemas.observability import DiagnosticsBundle
from app.schemas.usage import UsageEventPage, UsageSummaryRead
from app.services.admin_users import AdminUserService
from app.services.app_config import AppConfigService
from app.services.errors import ServiceError
from app.services.usage import UsageReadService
from app.telemetry.service import TelemetryService

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)
logger = get_logger("app.admin")


@router.get("/users", response_model=list[AdminUserRead])
def list_users(session: Session = Depends(get_session)) -> list[AdminUserRead]:
    """Return every user account with ownership rollups."""
    return AdminUserService(session).list_users()


@router.patch("/users/{user_id}", response_model=AdminUserRead)
def update_user(
    user_id: UUID,
    payload: AdminUserUpdate,
    session: Session = Depends(get_session),
) -> AdminUserRead:
    """Update a user's role or active flag."""
    service = AdminUserService(session)
    try:
        service.update_user(user_id, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    rows = {row.id: row for row in service.list_users()}
    return rows[user_id]


@router.get("/diagnostics/export", response_model=DiagnosticsBundle)
def export_diagnostics() -> DiagnosticsBundle:
    """Return recent redacted backend log records for a support bundle."""
    return build_diagnostics_bundle()


@router.get("/config", response_model=list[ConfigFieldRead])
def get_config_catalog(session: Session = Depends(get_session)) -> list[ConfigFieldRead]:
    """Return every config field's metadata alongside its resolved value."""
    return AppConfigService(session).field_catalog()


@router.patch("/config", response_model=list[ConfigFieldRead])
def update_config(
    payload: AppConfigUpdate,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(require_admin),
) -> list[ConfigFieldRead]:
    """Apply a sparse config patch and return the refreshed catalog."""
    service = AppConfigService(session)
    try:
        service.apply_update(payload, updated_by=current_user.id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    # Log which fields changed, never their values — a config value can be a
    # secret (provider defaults, limits), and the field paths are enough to
    # correlate a behavior change to an admin action.
    changed_fields = [
        f"{section}.{field}" for section, fields in payload.items() for field in fields
    ]
    logger.info(
        log_events.ADMIN_CONFIG_UPDATED,
        user_id=str(current_user.id),
        changed_fields=changed_fields,
    )
    return service.field_catalog()


@router.get("/usage/summary", response_model=AdminUsageSummary)
def get_usage_summary(
    days: int = Query(default=30, ge=1, le=365),
    session: Session = Depends(get_session),
) -> AdminUsageSummary:
    """Return instance-wide and per-user chat usage for the window."""
    return TelemetryService(session).usage_summary(days)


@router.get("/usage/timeseries", response_model=AdminUsageTimeseries)
def get_usage_timeseries(
    days: int = Query(default=30, ge=1, le=365),
    session: Session = Depends(get_session),
) -> AdminUsageTimeseries:
    """Return daily chat-usage points for the window, oldest first."""
    return TelemetryService(session).usage_timeseries(days)


@router.get("/usage/ledger/summary", response_model=UsageSummaryRead)
def get_usage_ledger_summary(
    start: datetime | None = None,
    end: datetime | None = None,
    group_by: UsageGroupBy = UsageGroupBy.MODEL,
    bucket: UsageBucket = UsageBucket.DAY,
    user_id: UUID | None = None,
    session: Session = Depends(get_session),
) -> UsageSummaryRead:
    """Summarize every account's ledger spend over a range."""
    try:
        query = build_query(user_id=user_id, start=start, end=end)
        return UsageReadService(session).summary(query, group_by=group_by, bucket=bucket)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/usage/ledger/events", response_model=UsageEventPage)
def list_usage_ledger_events(  # noqa: PLR0913 - one query parameter per argument
    start: datetime | None = None,
    end: datetime | None = None,
    kind: UsageKind | None = None,
    surface: UsageSurface | None = None,
    connection_id: UUID | None = None,
    model: str | None = None,
    user_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> UsageEventPage:
    """List every account's ledger rows, newest first."""
    try:
        query = build_query(
            user_id=user_id,
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
