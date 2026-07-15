"""Provider connection and provider-type catalog routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.schemas.providers import (
    ConnectionCreate,
    ConnectionRead,
    ConnectionUpdate,
    ConnectionValidateRequest,
    ConnectionValidationResult,
    ProviderTypeRead,
)
from app.services.connections import ConnectionService, provider_type_catalog
from app.services.errors import ServiceError

router = APIRouter(prefix="/api", tags=["connections"])


@router.get("/providers", response_model=list[ProviderTypeRead])
def list_provider_types(
    _current_user: models.User = Depends(get_current_user),
) -> list[ProviderTypeRead]:
    """List every provider type (registered adapters plus built-ins)."""
    return provider_type_catalog()


@router.get("/connections", response_model=list[ConnectionRead])
def list_connections(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[ConnectionRead]:
    """List the user's provider connections (secrets redacted)."""
    return ConnectionService(session).list_connections(current_user)


@router.post("/connections", response_model=ConnectionRead, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: ConnectionCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConnectionRead:
    """Register a provider connection after validating it live."""
    try:
        return ConnectionService(session).create(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.patch("/connections/{connection_id}", response_model=ConnectionRead)
def update_connection(
    connection_id: UUID,
    payload: ConnectionUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConnectionRead:
    """Relabel a connection or rotate config values."""
    try:
        return ConnectionService(session).update(current_user, connection_id, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete a connection (downstream references fail lazily)."""
    try:
        ConnectionService(session).delete(current_user, connection_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("/connections/validate", response_model=ConnectionValidationResult)
def validate_unsaved_connection(
    payload: ConnectionValidateRequest,
    session: Session = Depends(get_session),
    _current_user: models.User = Depends(get_current_user),
) -> ConnectionValidationResult:
    """Probe an unsaved connection config (pre-save check in the UI)."""
    try:
        return ConnectionService(session).validate_unsaved(payload.provider_type, payload.config)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("/connections/{connection_id}/validate", response_model=ConnectionValidationResult)
def validate_saved_connection(
    connection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConnectionValidationResult:
    """Re-probe a saved connection for the status panel."""
    try:
        return ConnectionService(session).validate_saved(current_user, connection_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
