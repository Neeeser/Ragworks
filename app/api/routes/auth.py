"""Authentication API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestFormStrict
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.core.security import create_access_token, verify_password
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.auth import (
    Token,
    UserCreate,
    UserKeyValidation,
    UserRead,
    UserSettingsUpdate,
)
from app.schemas.enums import UserRole
from app.services.accounts import AccountService
from app.services.errors import ServiceError
from app.services.provider_keys import validate_user_keys

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_user_read(user: models.User) -> UserRead:
    """Build a UserRead schema without exposing API keys."""
    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        role=UserRole(user.role),
        openrouter_configured=bool((user.openrouter_api_key or "").strip()),
        pinecone_configured=bool((user.pinecone_api_key or "").strip()),
        last_used_chat_model=user.last_used_chat_model,
        last_used_parameters=user.last_used_parameters,
        last_used_provider=user.last_used_provider,
        last_used_stream=user.last_used_stream,
        last_used_tool_collection_ids=user.last_used_tool_collection_ids,
        run_settings_order=user.run_settings_order,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, session: Session = Depends(get_session)) -> UserRead:
    """Register a new user account."""
    try:
        user = AccountService(session).register(payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _build_user_read(user)


@router.post("/token", response_model=Token)
def login_for_access_token(
    form_data: OAuth2PasswordRequestFormStrict = Depends(),
    session: Session = Depends(get_session),
) -> Token:
    """Authenticate a user and return an access token."""
    repo = UserRepository(session)
    user = repo.get_by_email(form_data.username)
    if (
        not user
        or not verify_password(form_data.password, user.hashed_password)
        or not user.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    access_token = create_access_token(subject=str(user.id))
    return Token(access_token=access_token)


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: models.User = Depends(get_current_user)) -> UserRead:
    """Return the authenticated user's profile."""
    return _build_user_read(current_user)


@router.get("/me/keys/validate", response_model=UserKeyValidation)
def validate_current_user_keys(
    current_user: models.User = Depends(get_current_user),
) -> UserKeyValidation:
    """Validate stored API keys for the authenticated user."""
    return validate_user_keys(current_user)


@router.patch("/me", response_model=UserRead)
def update_current_user(
    payload: UserSettingsUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    """Update settings for the authenticated user."""
    try:
        user = AccountService(session).update_settings(current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _build_user_read(user)
