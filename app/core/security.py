"""Security helpers for hashing passwords and issuing JWTs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from jose import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
settings = get_settings()


def hash_password(password: str) -> str:
    """Hash a plaintext password using the configured context."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plaintext password to a stored hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(subject: str, expires_minutes: int | None = None) -> str:
    """Create a JWT access token for the provided subject."""
    minutes = (
        expires_minutes if expires_minutes is not None else settings.access_token_expire_minutes
    )
    expire_delta = timedelta(minutes=minutes)
    expire = datetime.now(UTC) + expire_delta
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
