"""FastAPI dependency helpers for authentication and database access."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlmodel import Session

from app.api.config import get_settings
from app.core.security import create_access_token
from app.db.models import User
from app.db.repositories import UserRepository
from app.db.session import get_session

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_db_session() -> Session:
    """Yield a database session for FastAPI dependencies."""
    yield from get_session()


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


def require_user_api_keys(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the user has configured OpenRouter and Pinecone API keys."""
    missing: list[str] = []
    if not (current_user.openrouter_api_key or "").strip():
        missing.append("OpenRouter")
    if not (current_user.pinecone_api_key or "").strip():
        missing.append("Pinecone")
    if missing:
        missing_label = " and ".join(missing)
        noun = "key is" if len(missing) == 1 else "keys are"
        pronoun = "it" if len(missing) == 1 else "them"
        detail = (
            f"{missing_label} API {noun} not configured. "
            f"Update {pronoun} in Settings to continue."
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )
    return current_user


def issue_access_token(user: User) -> str:
    """Issue an access token for a user."""
    return create_access_token(str(user.id))
