"""Tests for password hashing and JWT issuance in app.core.security."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from jose import jwt

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password


def test_hash_and_verify_password_roundtrip() -> None:
    hashed = hash_password("correct-password")

    assert hashed != "correct-password"
    assert verify_password("correct-password", hashed)


def test_verify_password_rejects_wrong_password() -> None:
    hashed = hash_password("correct-password")

    assert verify_password("wrong-password", hashed) is False


def test_create_access_token_embeds_subject() -> None:
    settings = get_settings()
    token = create_access_token("user-123")

    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])

    assert payload["sub"] == "user-123"


def test_create_access_token_honors_configured_expiry() -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    token = create_access_token("user-123")

    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    expires_at = datetime.fromtimestamp(payload["exp"], tz=UTC)

    expected_expiry = now + timedelta(minutes=settings.access_token_expire_minutes)
    assert abs((expires_at - expected_expiry).total_seconds()) < 5


def test_create_access_token_honors_expires_minutes_override() -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    token = create_access_token("user-123", expires_minutes=5)

    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    expires_at = datetime.fromtimestamp(payload["exp"], tz=UTC)

    expected_expiry = now + timedelta(minutes=5)
    assert abs((expires_at - expected_expiry).total_seconds()) < 5


def test_create_access_token_honors_explicit_zero_expiry() -> None:
    """`expires_minutes=0` must mean "expires immediately", not "unset".

    `0 or default` is falsy in Python, so a naive `expires_minutes or default`
    silently substitutes the configured default for an explicit 0 — this
    regression-tests that a caller asking for immediate expiry gets it.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    token = create_access_token("user-123", expires_minutes=0)

    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    expires_at = datetime.fromtimestamp(payload["exp"], tz=UTC)

    assert abs((expires_at - now).total_seconds()) < 5
