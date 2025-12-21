from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import jwt
from sqlmodel import Session

from app.api import dependencies
from app.api.config import get_settings
from app.core.security import create_access_token
from app.db import models


def _create_user(session: Session, *, is_active: bool = True) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="Example User",
        hashed_password="hashed",
        is_active=is_active,
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
    payload = {"exp": datetime.now(timezone.utc) + timedelta(minutes=5)}
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token=token, session=session)


def test_get_current_user_rejects_invalid_subject(session: Session) -> None:
    _create_user(session)
    token = create_access_token("not-a-uuid")

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token=token, session=session)


def test_get_current_user_rejects_inactive_user(session: Session) -> None:
    user = _create_user(session, is_active=False)
    token = create_access_token(str(user.id))

    with pytest.raises(HTTPException):
        dependencies.get_current_user(token=token, session=session)


def test_dependency_helpers_return_expected_types(session: Session) -> None:
    user = _create_user(session)

    generator = dependencies.get_db_session()
    db_session = next(generator)
    generator.close()

    assert isinstance(db_session, Session)
    assert dependencies.get_user_repository(session).session is session
    assert isinstance(dependencies.issue_access_token(user), str)
