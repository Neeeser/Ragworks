"""Admin API routes: user management.

The router itself carries the ``require_admin`` dependency so every route in
it — and every route added to it later — is admin-gated by construction.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_session, require_admin
from app.api.routes.utils import to_http_exception
from app.schemas.admin import AdminUserRead, AdminUserUpdate
from app.services.admin_users import AdminUserService
from app.services.errors import ServiceError

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


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
