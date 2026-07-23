"""First-run setup API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import (
    collection_to_schema,
    to_http_exception,
    validation_issue_to_schema,
)
from app.db import models
from app.schemas.setup import (
    SetupBootstrapRequest,
    SetupBootstrapResponse,
    SetupStatusRead,
)
from app.services.errors import ServiceError
from app.services.setup import SetupService

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatusRead)
def setup_status(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SetupStatusRead:
    """Return the current user's derived first-run readiness."""
    return SetupService(session).status(current_user)


@router.post(
    "/bootstrap",
    response_model=SetupBootstrapResponse,
    status_code=status.HTTP_201_CREATED,
)
def setup_bootstrap(
    payload: SetupBootstrapRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SetupBootstrapResponse:
    """Install the wizard's choices: default pipelines + first collection."""
    try:
        result = SetupService(session).bootstrap(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return SetupBootstrapResponse(
        collection=collection_to_schema(session, result.collection),
        warnings=[validation_issue_to_schema(issue) for issue in result.warnings],
    )
