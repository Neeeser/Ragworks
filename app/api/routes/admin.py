"""Admin API routes: user management.

The router itself carries the ``require_admin`` dependency so every route in
it — and every route added to it later — is admin-gated by construction.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.api.dependencies import get_session, require_admin
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
from app.schemas.observability import DiagnosticsBundle
from app.services.admin_users import AdminUserService
from app.services.app_config import AppConfigService
from app.services.errors import ServiceError
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
