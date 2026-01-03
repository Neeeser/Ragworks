from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import auth as auth_routes
from app.core.security import hash_password
from app.db import models

from app.schemas.auth import UserCreate, UserSettingsUpdate


def test_register_user_rejects_duplicate_email(session: Session) -> None:
    payload = UserCreate(email="user@example.com", full_name="User", password="Str0ngPass!")

    auth_routes.register_user(payload, session=session)

    with pytest.raises(HTTPException) as excinfo:
        auth_routes.register_user(payload, session=session)

    assert excinfo.value.status_code == 400


def test_login_for_access_token_rejects_invalid_password(session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password=hash_password("correct-password"),
    )
    session.add(user)
    session.commit()

    form_data = SimpleNamespace(username="user@example.com", password="wrong-password")

    with pytest.raises(HTTPException) as excinfo:
        auth_routes.login_for_access_token(form_data, session=session)

    assert excinfo.value.status_code == 401


def test_validate_current_user_keys_returns_missing() -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )

    result = auth_routes.validate_current_user_keys(current_user=user)

    assert result.openrouter.configured is False
    assert result.openrouter.valid is False
    assert result.pinecone.configured is False
    assert result.pinecone.valid is False


def test_validate_current_user_keys_reports_connected(monkeypatch) -> None:
    class _StubOpenRouter:
        def get_current_key(self):
            return {"data": {"label": "valid"}}

    class _StubPinecone:
        def list_indexes(self):
            return []

    monkeypatch.setattr(auth_routes, "get_openrouter_client", lambda *_args, **_kwargs: _StubOpenRouter())
    monkeypatch.setattr(auth_routes, "get_pinecone_client", lambda *_args, **_kwargs: _StubPinecone())

    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )

    result = auth_routes.validate_current_user_keys(current_user=user)

    assert result.openrouter.configured is True
    assert result.openrouter.valid is True
    assert result.pinecone.configured is True
    assert result.pinecone.valid is True


def test_update_current_user_rejects_invalid_openrouter_key(
    monkeypatch,
    session: Session,
) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    class _StubOpenRouter:
        def get_current_key(self):
            request = httpx.Request("GET", "https://openrouter.ai/api/v1/key")
            response = httpx.Response(401, request=request)
            raise httpx.HTTPStatusError("Unauthorized", request=request, response=response)

    monkeypatch.setattr(auth_routes, "get_openrouter_client", lambda *_args, **_kwargs: _StubOpenRouter())

    with pytest.raises(HTTPException) as excinfo:
        auth_routes.update_current_user(
            UserSettingsUpdate(openrouter_api_key="bad-key"),
            current_user=user,
            session=session,
        )

    session.refresh(user)

    assert excinfo.value.status_code == 400
    assert user.openrouter_api_key is None


def test_validate_openrouter_key_handles_server_error(monkeypatch) -> None:
    class _StubOpenRouter:
        def get_current_key(self):
            request = httpx.Request("GET", "https://openrouter.ai/api/v1/key")
            response = httpx.Response(500, request=request)
            raise httpx.HTTPStatusError("Server error", request=request, response=response)

    monkeypatch.setattr(auth_routes, "get_openrouter_client", lambda *_args, **_kwargs: _StubOpenRouter())

    status = auth_routes._validate_openrouter_key("bad-key")

    assert status.configured is True
    assert status.valid is False
    assert status.message == "OpenRouter validation failed."


def test_validate_openrouter_key_handles_http_error(monkeypatch) -> None:
    class _StubOpenRouter:
        def get_current_key(self):
            raise httpx.HTTPError("Network error")

    monkeypatch.setattr(auth_routes, "get_openrouter_client", lambda *_args, **_kwargs: _StubOpenRouter())

    status = auth_routes._validate_openrouter_key("bad-key")

    assert status.valid is False
    assert status.message == "OpenRouter validation failed."


def test_validate_pinecone_key_rejects_invalid(monkeypatch) -> None:
    class _StubPinecone:
        def list_indexes(self):
            raise auth_routes.PineconeException("invalid")

    monkeypatch.setattr(auth_routes, "get_pinecone_client", lambda *_args, **_kwargs: _StubPinecone())

    status = auth_routes._validate_pinecone_key("bad-key")

    assert status.configured is True
    assert status.valid is False
    assert status.message == "Invalid Pinecone API key."


def test_update_current_user_clears_keys(session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    updated = auth_routes.update_current_user(
        UserSettingsUpdate(openrouter_api_key=" ", pinecone_api_key=" "),
        current_user=user,
        session=session,
    )

    assert updated.openrouter_configured is False
    assert updated.pinecone_configured is False


def test_update_current_user_rejects_invalid_pinecone_key(monkeypatch, session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    class _StubPinecone:
        def list_indexes(self):
            raise auth_routes.PineconeException("invalid")

    monkeypatch.setattr(auth_routes, "get_pinecone_client", lambda *_args, **_kwargs: _StubPinecone())

    with pytest.raises(HTTPException) as excinfo:
        auth_routes.update_current_user(
            UserSettingsUpdate(pinecone_api_key="bad-key"),
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 400


def test_update_current_user_accepts_valid_keys(monkeypatch, session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    monkeypatch.setattr(
        auth_routes,
        "_validate_openrouter_key",
        lambda *_args, **_kwargs: auth_routes.ProviderKeyStatus(
            configured=True,
            valid=True,
            message="Connected.",
        ),
    )
    monkeypatch.setattr(
        auth_routes,
        "_validate_pinecone_key",
        lambda *_args, **_kwargs: auth_routes.ProviderKeyStatus(
            configured=True,
            valid=True,
            message="Connected.",
        ),
    )

    updated = auth_routes.update_current_user(
        UserSettingsUpdate(openrouter_api_key="openrouter-key", pinecone_api_key="pinecone-key"),
        current_user=user,
        session=session,
    )

    assert updated.openrouter_configured is True
    assert updated.pinecone_configured is True


def test_update_current_user_sets_only_openrouter(monkeypatch, session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    monkeypatch.setattr(
        auth_routes,
        "_validate_openrouter_key",
        lambda *_args, **_kwargs: auth_routes.ProviderKeyStatus(
            configured=True,
            valid=True,
            message="Connected.",
        ),
    )

    updated = auth_routes.update_current_user(
        UserSettingsUpdate(openrouter_api_key="openrouter-key"),
        current_user=user,
        session=session,
    )

    assert updated.openrouter_configured is True
    assert updated.pinecone_configured is False


def test_update_current_user_sets_only_pinecone(monkeypatch, session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    monkeypatch.setattr(
        auth_routes,
        "_validate_pinecone_key",
        lambda *_args, **_kwargs: auth_routes.ProviderKeyStatus(
            configured=True,
            valid=True,
            message="Connected.",
        ),
    )

    updated = auth_routes.update_current_user(
        UserSettingsUpdate(pinecone_api_key="pinecone-key"),
        current_user=user,
        session=session,
    )

    assert updated.openrouter_configured is False
    assert updated.pinecone_configured is True
