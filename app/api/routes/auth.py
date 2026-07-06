"""Authentication API routes."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestFormStrict
from pinecone.exceptions import PineconeException
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.clients.openrouter import get_openrouter_client
from app.clients.pinecone import get_pinecone_client
from app.core.security import create_access_token, hash_password, verify_password
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.auth import (
    ProviderKeyStatus,
    Token,
    UserCreate,
    UserKeyValidation,
    UserRead,
    UserSettingsUpdate,
)
from app.services.pipelines import PipelineService

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_user_read(user: models.User) -> UserRead:
    """Build a UserRead schema without exposing API keys."""
    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
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


def _missing_key_status() -> ProviderKeyStatus:
    """Return a standardized missing-key status payload."""
    return ProviderKeyStatus(configured=False, valid=False, message="Missing.")


def _validate_openrouter_key(api_key: str) -> ProviderKeyStatus:
    """Validate an OpenRouter API key against the /key endpoint."""
    resolved = (api_key or "").strip()
    if not resolved:
        return _missing_key_status()
    try:
        client = get_openrouter_client(resolved)
        client.get_current_key()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            return ProviderKeyStatus(
                configured=True,
                valid=False,
                message="Invalid OpenRouter API key.",
            )
        return ProviderKeyStatus(
            configured=True,
            valid=False,
            message="OpenRouter validation failed.",
        )
    except httpx.HTTPError:
        return ProviderKeyStatus(
            configured=True,
            valid=False,
            message="OpenRouter validation failed.",
        )
    return ProviderKeyStatus(configured=True, valid=True, message="Connected.")


def _validate_pinecone_key(api_key: str) -> ProviderKeyStatus:
    """Validate a Pinecone API key by listing indexes."""
    resolved = (api_key or "").strip()
    if not resolved:
        return _missing_key_status()
    try:
        client = get_pinecone_client(api_key=resolved)
        client.list_indexes()
    except PineconeException:
        return ProviderKeyStatus(
            configured=True,
            valid=False,
            message="Invalid Pinecone API key.",
        )
    return ProviderKeyStatus(configured=True, valid=True, message="Connected.")


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, session: Session = Depends(get_session)) -> UserRead:
    """Register a new user account."""
    repo = UserRepository(session)
    existing = repo.get_by_email(payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered.",
        )
    user = models.User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
    )
    repo.add(user)
    PipelineService(session).ensure_default_pipelines(user)
    session.commit()
    session.refresh(user)
    return _build_user_read(user)


@router.post("/token", response_model=Token)
def login_for_access_token(
    form_data: OAuth2PasswordRequestFormStrict = Depends(),
    session: Session = Depends(get_session),
) -> Token:
    """Authenticate a user and return an access token."""
    repo = UserRepository(session)
    user = repo.get_by_email(form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
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
    return UserKeyValidation(
        openrouter=_validate_openrouter_key(current_user.openrouter_api_key or ""),
        pinecone=_validate_pinecone_key(current_user.pinecone_api_key or ""),
    )


@router.patch("/me", response_model=UserRead)
def update_current_user(
    payload: UserSettingsUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    """Update settings for the authenticated user."""
    errors: dict[str, str] = {}
    openrouter_value = None
    if payload.openrouter_api_key is not None:
        openrouter_value = payload.openrouter_api_key.strip()
        if openrouter_value:
            status_result = _validate_openrouter_key(openrouter_value)
            if not status_result.valid:
                errors["openrouter_api_key"] = (
                    status_result.message or "Invalid OpenRouter API key."
                )

    pinecone_value = None
    if payload.pinecone_api_key is not None:
        pinecone_value = payload.pinecone_api_key.strip()
        if pinecone_value:
            status_result = _validate_pinecone_key(pinecone_value)
            if not status_result.valid:
                errors["pinecone_api_key"] = (
                    status_result.message or "Invalid Pinecone API key."
                )

    if errors:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=errors)

    if payload.openrouter_api_key is not None:
        current_user.openrouter_api_key = openrouter_value or None
    if payload.pinecone_api_key is not None:
        current_user.pinecone_api_key = pinecone_value or None
    if payload.run_settings_order is not None:
        current_user.run_settings_order = [entry.value for entry in payload.run_settings_order]
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return _build_user_read(current_user)
