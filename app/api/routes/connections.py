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
    ConnectionDraftValidateRequest,
    ConnectionRead,
    ConnectionUpdate,
    ConnectionValidateRequest,
    ConnectionValidationResult,
    ProviderTypeRead,
    ServerProbeRequest,
    ServerProbeResult,
)
from app.services.connections import ConnectionService, provider_type_catalog
from app.services.errors import ServiceError
from app.services.server_probe import probe_server

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


@router.post("/providers/probe", response_model=ServerProbeResult)
def probe_custom_server(
    payload: ServerProbeRequest,
    session: Session = Depends(get_session),
    _current_user: models.User = Depends(get_current_user),
) -> ServerProbeResult:
    """Discover which standard surfaces a custom server answers on."""
    try:
        return probe_server(payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("/connections/{connection_id}/validate", response_model=ConnectionValidationResult)
def validate_saved_connection(
    connection_id: UUID,
    payload: ConnectionDraftValidateRequest | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConnectionValidationResult:
    """Re-probe a saved connection, or probe unsaved edits to it.

    The body is optional: with none, this is the status panel's refresh of the
    stored config. With one, it is the edit dialog's Test button, probing the
    draft overlaid on the stored config without saving either.
    """
    try:
        return ConnectionService(session).validate_saved(
            current_user,
            connection_id,
            draft_config=payload.config if payload else None,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
