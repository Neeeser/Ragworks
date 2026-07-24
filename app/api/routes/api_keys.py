"""API key management endpoints (JWT-gated).

Keys are credentials for the MCP endpoint; managing them always requires a
signed-in session, never a key — a key can never mint or widen another key.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.schemas.api_keys import ApiKeyCreate, ApiKeyCreated, ApiKeyList
from app.services.api_keys import ApiKeyService, to_api_key_read
from app.services.errors import ServiceError

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])


@router.get("", response_model=ApiKeyList)
def list_api_keys(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApiKeyList:
    """List the signed-in user's API keys (never their secrets)."""
    keys = ApiKeyService(session).list_keys(current_user)
    return ApiKeyList(keys=[to_api_key_read(key) for key in keys])


@router.post("", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
def create_api_key(
    payload: ApiKeyCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ApiKeyCreated:
    """Issue a key, returning the plaintext secret exactly once."""
    service = ApiKeyService(session)
    try:
        api_key, secret = service.issue(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    session.commit()
    session.refresh(api_key)
    return ApiKeyCreated(key=to_api_key_read(api_key), secret=secret)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(
    key_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Revoke a key; the row survives as an audit record."""
    try:
        ApiKeyService(session).revoke(current_user, key_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    session.commit()
