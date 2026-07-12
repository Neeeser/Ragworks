"""FastAPI dependency helpers for authentication and database access."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlmodel import Session

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.engine import get_session as get_session  # re-exported for routes
from app.db.models import User
from app.db.repositories import AuthSessionRepository, UserRepository
from app.schemas.enums import UserRole
from app.utils.time import ensure_utc, utc_now

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_user_repository(session: Session = Depends(get_session)) -> UserRepository:
    """Return a user repository for the current request session."""
    return UserRepository(session)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    """Return the authenticated user or raise an HTTP 401."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise credentials_exception from exc

    subject = payload.get("sub")
    if subject is None:
        raise credentials_exception

    repo = UserRepository(session)
    try:
        subject_uuid = UUID(str(subject))
    except ValueError as exc:
        raise credentials_exception from exc

    user = repo.get(subject_uuid)
    if user is None or not user.is_active:
        raise credentials_exception
    session_id = payload.get("sid")
    if session_id is not None:
        try:
            auth_session = AuthSessionRepository(session).get_owned(
                UUID(str(session_id)), user.id
            )
        except ValueError as exc:
            raise credentials_exception from exc
        if (
            auth_session is None
            or auth_session.revoked_at is not None
            or ensure_utc(auth_session.expires_at) <= utc_now()
        ):
            raise credentials_exception
    return user


def require_openrouter_key(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the user has configured an OpenRouter API key."""
    if not (current_user.openrouter_api_key or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OpenRouter API key is not configured. Update it in Settings to continue.",
        )
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user, rejecting non-admins with a 403."""
    if current_user.role != UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required.",
        )
    return current_user


def issue_access_token(user: User) -> str:
    """Issue an access token for a user."""
    return create_access_token(str(user.id))
