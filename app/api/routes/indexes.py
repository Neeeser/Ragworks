"""Backend-aware vector-index management API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.schemas.enums import IndexBackend
from app.schemas.indexes import (
    BackendInfoList,
    IndexCreateRequest,
    IndexDeleteResponse,
    IndexList,
    IndexRead,
)
from app.services.errors import ServiceError
from app.services.index_admin import IndexAdminService

router = APIRouter(prefix="/api/indexes", tags=["indexes"])


@router.get("", response_model=IndexList)
def list_indexes(
    backend: IndexBackend | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> IndexList:
    """List indexes for one backend, or every usable backend when omitted."""
    try:
        indexes = IndexAdminService(session).list_indexes(current_user, backend)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return IndexList(indexes=indexes)


# Declared before `/{index_name}` so "backends" never matches as an index name.
@router.get("/backends", response_model=BackendInfoList)
def list_backends(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> BackendInfoList:
    """Describe every vector-store backend's usability for the current user."""
    return BackendInfoList(backends=IndexAdminService(session).backends(current_user))


@router.get("/{index_name}", response_model=IndexRead)
def describe_index(
    index_name: str,
    backend: IndexBackend,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> IndexRead:
    """Return details for a specific index on a backend."""
    try:
        return IndexAdminService(session).describe_index(current_user, backend, index_name)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("", response_model=IndexRead, status_code=status.HTTP_201_CREATED)
def create_index(
    payload: IndexCreateRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> IndexRead:
    """Create an index on the requested backend."""
    try:
        return IndexAdminService(session).create_index(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.delete("/{index_name}", response_model=IndexDeleteResponse)
def delete_index(
    index_name: str,
    backend: IndexBackend,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> IndexDeleteResponse:
    """Delete an index by name on a backend."""
    try:
        IndexAdminService(session).delete_index(current_user, backend, index_name)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return IndexDeleteResponse()
