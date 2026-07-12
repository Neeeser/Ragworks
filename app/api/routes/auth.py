"""Authentication API routes."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestFormStrict
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.core.config import get_settings
from app.core.security import create_access_token, verify_password
from app.db import models
from app.db.repositories import AuthSessionRepository, UserRepository
from app.schemas.auth import (
    AuthSessionRead,
    ProviderKeyStatus,
    ProviderKeyValidateRequest,
    Token,
    UserCreate,
    UserKeyValidation,
    UserRead,
    UserSettingsUpdate,
)
from app.schemas.enums import UserRole
from app.services.accounts import AccountService
from app.services.app_config import get_app_config
from app.services.errors import ServiceError
from app.services.provider_keys import Provider, validate_key, validate_user_keys
from app.telemetry import record
from app.telemetry.events import UserSignedIn
from app.utils.time import ensure_utc, utc_now

router = APIRouter(prefix="/api/auth", tags=["auth"])
_REFRESH_COOKIE = "ragworks_refresh"
_ROTATION_GRACE = timedelta(seconds=30)


def _digest_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _rotate_refresh_token(token: str) -> str:
    """Derive one stable successor so concurrent refreshes converge."""
    return hmac.new(
        get_settings().jwt_secret_key.encode(), token.encode(), hashlib.sha256
    ).hexdigest()


def _set_refresh_cookie(response: Response, token: str, persistent: bool, days: int) -> None:
    response.set_cookie(
        _REFRESH_COOKIE,
        token,
        max_age=days * 86400 if persistent else None,
        httponly=True,
        secure=not get_settings().debug,
        samesite="lax",
        path="/api/auth",
    )
    response.headers["Cache-Control"] = "no-store"


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path="/api/auth")
    response.headers["Cache-Control"] = "no-store"


def _create_refresh_session(
    user: models.User, request: Request, session: Session, persistent: bool
) -> tuple[str, models.AuthSession]:
    token = secrets.token_urlsafe(32)
    now = utc_now()
    auth_session = AuthSessionRepository(session).add(
        models.AuthSession(
            user_id=user.id,
            token_digest=_digest_refresh_token(token),
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
            persistent=persistent,
            created_at=now,
            last_used_at=now,
            expires_at=now + timedelta(days=user.remember_session_days),
        )
    )
    return token, auth_session


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
        remember_session_days=user.remember_session_days,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, session: Session = Depends(get_session)) -> UserRead:
    """Register a new user account."""
    if not get_app_config().auth.allow_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is disabled on this server.",
        )
    try:
        user = AccountService(session).register(payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _build_user_read(user)


@router.post("/token", response_model=Token)
def login_for_access_token(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestFormStrict = Depends(),
    remember_me: bool = Form(False),
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
    refresh_token, auth_session = _create_refresh_session(user, request, session, remember_me)
    access_token = create_access_token(subject=str(user.id), session_id=str(auth_session.id))
    _set_refresh_cookie(response, refresh_token, remember_me, user.remember_session_days)
    # Telemetry hooks belong at the service layer, but login has no service --
    # the credential exchange lives entirely in this route, so the fact is
    # recorded where it becomes true.
    record(UserSignedIn(user_id=user.id))
    return Token(access_token=access_token)


@router.post("/refresh", response_model=Token)
def refresh_access_token(request: Request, response: Response, session: Session = Depends(get_session)) -> Token:
    token = request.cookies.get(_REFRESH_COOKIE)
    repo = AuthSessionRepository(session)
    token_digest = _digest_refresh_token(token or "")
    auth_session = repo.get_by_digest(token_digest)
    now = utc_now()
    if auth_session is None:
        replayed = repo.get_by_previous_digest(token_digest)
        if (
            replayed
            and replayed.revoked_at is None
            and ensure_utc(replayed.expires_at) > now
            and now - ensure_utc(replayed.last_used_at) <= _ROTATION_GRACE
        ):
            replayed_user = UserRepository(session).get(replayed.user_id)
            if replayed_user is None or not replayed_user.is_active:
                replayed.revoked_at = now
                session.add(replayed)
                session.commit()
                _clear_refresh_cookie(response)
                raise HTTPException(status_code=401, detail="Could not refresh session")
            rotated = _rotate_refresh_token(token or "")
            _set_refresh_cookie(
                response,
                rotated,
                replayed.persistent,
                max(1, (ensure_utc(replayed.expires_at) - now).days + 1),
            )
            return Token(
                access_token=create_access_token(
                    str(replayed.user_id), session_id=str(replayed.id)
                )
            )
        if replayed and replayed.revoked_at is None:
            replayed.revoked_at = now
            session.add(replayed)
            session.commit()
    if (
        not auth_session
        or auth_session.revoked_at
        or ensure_utc(auth_session.expires_at) <= now
    ):
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Could not refresh session")
    user = UserRepository(session).get(auth_session.user_id)
    if not user or not user.is_active:
        auth_session.revoked_at = now
        session.add(auth_session)
        session.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Could not refresh session")
    rotated = _rotate_refresh_token(token or "")
    claimed = repo.rotate_if_current(
        auth_session.id,
        current_digest=token_digest,
        rotated_digest=_digest_refresh_token(rotated),
        used_at=now,
    )
    session.commit()
    if not claimed:
        session.expire_all()
        concurrent_winner = repo.get_by_previous_digest(token_digest)
        if (
            concurrent_winner is None
            or concurrent_winner.revoked_at is not None
            or ensure_utc(concurrent_winner.expires_at) <= now
            or now - ensure_utc(concurrent_winner.last_used_at) > _ROTATION_GRACE
        ):
            _clear_refresh_cookie(response)
            raise HTTPException(status_code=401, detail="Could not refresh session")
    remaining_days = max(1, (ensure_utc(auth_session.expires_at) - now).days + 1)
    _set_refresh_cookie(response, rotated, auth_session.persistent, remaining_days)
    return Token(
        access_token=create_access_token(str(user.id), session_id=str(auth_session.id))
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, session: Session = Depends(get_session)) -> None:
    token = request.cookies.get(_REFRESH_COOKIE)
    auth_session = AuthSessionRepository(session).get_by_digest(_digest_refresh_token(token or ""))
    if auth_session and not auth_session.revoked_at:
        auth_session.revoked_at = utc_now()
        session.add(auth_session)
        session.commit()
    _clear_refresh_cookie(response)


@router.get("/sessions", response_model=list[AuthSessionRead])
def list_auth_sessions(
    request: Request, current_user: models.User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[AuthSessionRead]:
    digest = _digest_refresh_token(request.cookies.get(_REFRESH_COOKIE, ""))
    now = utc_now()
    return [
        AuthSessionRead(
            id=item.id, user_agent=item.user_agent, ip_address=item.ip_address,
            created_at=item.created_at, last_used_at=item.last_used_at,
            expires_at=item.expires_at, current=item.token_digest == digest,
        )
        for item in AuthSessionRepository(session).list_active(current_user.id)
        if ensure_utc(item.expires_at) > now
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_auth_session(
    session_id: UUID, current_user: models.User = Depends(get_current_user), session: Session = Depends(get_session)
) -> None:
    item = AuthSessionRepository(session).get_owned(session_id, current_user.id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    item.revoked_at = utc_now()
    session.add(item)
    session.commit()


@router.delete("/sessions", status_code=status.HTTP_204_NO_CONTENT)
def revoke_all_auth_sessions(
    response: Response,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    now = utc_now()
    for item in AuthSessionRepository(session).list_active(current_user.id):
        item.revoked_at = now
        session.add(item)
    session.commit()
    _clear_refresh_cookie(response)


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


@router.post("/keys/validate", response_model=ProviderKeyStatus)
def validate_provider_key(
    payload: ProviderKeyValidateRequest,
    _current_user: models.User = Depends(get_current_user),
) -> ProviderKeyStatus:
    """Probe a pasted provider key against its provider without saving it."""
    return validate_key(Provider(payload.provider), payload.api_key)


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
