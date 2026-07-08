from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from jose import jwt
from sqlmodel import Session

from app.api import dependencies
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db import models


def _create_user(
    session: Session,
    *,
    is_active: bool = True,
    openrouter_api_key: str | None = None,
    pinecone_api_key: str | None = None,
) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="Example User",
        hashed_password="hashed",
        is_active=is_active,
        openrouter_api_key=openrouter_api_key,
        pinecone_api_key=pinecone_api_key,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_get_current_user_accepts_valid_token(session: Session) -> None:
    user = _create_user(session)
    token = create_access_token(str(user.id))

    resolved = dependencies.get_current_user(token=token, session=session)

    assert resolved.id == user.id


def test_get_current_user_rejects_invalid_token(session: Session) -> None:
    _create_user(session)

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token="not-a-token", session=session)


def test_get_current_user_rejects_missing_subject(session: Session) -> None:
    _create_user(session)
    settings = get_settings()
    payload = {"exp": datetime.now(UTC) + timedelta(minutes=5)}
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token=token, session=session)


def test_get_current_user_rejects_invalid_subject(session: Session) -> None:
    _create_user(session)
    token = create_access_token("not-a-uuid")

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token=token, session=session)


def test_get_current_user_rejects_expired_token(session: Session) -> None:
    user = _create_user(session)
    token = create_access_token(str(user.id), expires_minutes=-1)

    with pytest.raises(HTTPException) as excinfo:
        dependencies.get_current_user(token=token, session=session)

    assert excinfo.value.status_code == 401


def test_get_current_user_rejects_inactive_user(session: Session) -> None:
    user = _create_user(session, is_active=False)
    token = create_access_token(str(user.id))

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token=token, session=session)


def test_require_openrouter_key_rejects_missing_value(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        dependencies.require_openrouter_key(current_user=user)

    assert excinfo.value.status_code == 400


def test_require_openrouter_key_accepts_valid_value(session: Session) -> None:
    user = _create_user(session, openrouter_api_key="openrouter-key")

    assert dependencies.require_openrouter_key(current_user=user) == user
