"""Behavior tests for AppConfigService and the cached get_app_config().

Every test that touches an env-pin monkeypatches `os.environ` (via
`monkeypatch.setenv`) and must clear the `get_settings` cache both before and
after so the pin takes effect and never leaks into later tests. The autouse
`_invalidate_cache` fixture below resets `get_app_config`'s process cache
around each test for the same reason.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import AppSettingRepository, UserRepository
from app.schemas.admin import ConfigSource
from app.services import app_config as app_config_module
from app.services.app_config import (
    AppConfigService,
    get_app_config,
    invalidate_app_config_cache,
)
from app.services.errors import InvalidInputError


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Ensure `get_app_config`'s process-wide cache never leaks across tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _make_admin(session: Session) -> models.User:
    user = models.User(email="admin@example.com", hashed_password="hashed", role="admin")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def test_precedence_default_then_db_then_env(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    service = AppConfigService(session)
    assert service.effective_config().uploads.max_upload_size_mb == 50

    AppSettingRepository(session).upsert("uploads.max_upload_size_mb", 10, updated_by=None)
    session.commit()
    assert service.effective_config().uploads.max_upload_size_mb == 10

    AppSettingRepository(session).upsert("models.default_chat_model", "db/model", updated_by=None)
    session.commit()
    monkeypatch.setenv("OPENROUTER_DEFAULT_CHAT_MODEL", "env/model")
    get_settings.cache_clear()
    try:
        assert service.effective_config().models.default_chat_model == "env/model"
    finally:
        get_settings.cache_clear()


def test_patch_rejects_env_pinned_unknown_and_invalid_fields(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = _make_admin(session)
    service = AppConfigService(session)

    monkeypatch.setenv("OPENROUTER_DEFAULT_CHAT_MODEL", "env/model")
    get_settings.cache_clear()
    try:
        with pytest.raises(InvalidInputError) as exc_info:
            service.apply_update({"models": {"default_chat_model": "new/model"}}, admin.id)
        assert "models.default_chat_model" in exc_info.value.detail
    finally:
        get_settings.cache_clear()

    with pytest.raises(InvalidInputError) as exc_info:
        service.apply_update({"uploads": {"nope": 1}}, admin.id)
    assert "uploads.nope" in exc_info.value.detail

    with pytest.raises(InvalidInputError) as exc_info:
        service.apply_update({"uploads": {"max_upload_size_mb": 0}}, admin.id)
    assert "uploads.max_upload_size_mb" in exc_info.value.detail


def test_patch_writes_overrides_and_null_resets(session: Session) -> None:
    admin = _make_admin(session)
    service = AppConfigService(session)

    updated = service.apply_update({"auth": {"allow_registration": False}}, admin.id)
    assert updated.auth.allow_registration is False

    with Session(session.get_bind()) as fresh:
        overrides = AppSettingRepository(fresh).all_overrides()
    assert overrides == {"auth.allow_registration": False}
    assert service.effective_config().auth.allow_registration is False

    reset = service.apply_update({"auth": {"allow_registration": None}}, admin.id)
    assert reset.auth.allow_registration is True

    with Session(session.get_bind()) as fresh:
        overrides = AppSettingRepository(fresh).all_overrides()
    assert overrides == {}
    assert service.effective_config().auth.allow_registration is True


def test_invalid_db_override_is_dropped_with_warning(
    session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    AppSettingRepository(session).upsert("uploads.max_upload_size_mb", "garbage", updated_by=None)
    session.commit()

    service = AppConfigService(session)
    with caplog.at_level(logging.WARNING):
        config = service.effective_config()

    assert config.uploads.max_upload_size_mb == 50
    assert any("uploads.max_upload_size_mb" in record.message for record in caplog.records)


def test_get_app_config_caches_and_invalidates(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {"count": 0}
    real_session_scope = app_config_module.session_scope

    def _counting_session_scope() -> object:
        calls["count"] += 1
        return real_session_scope()

    monkeypatch.setattr(app_config_module, "session_scope", _counting_session_scope)

    get_app_config()
    get_app_config()
    assert calls["count"] == 1

    invalidate_app_config_cache()
    get_app_config()
    assert calls["count"] == 2


def test_field_catalog_reports_source(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    service = AppConfigService(session)
    catalog = {field.key: field for field in service.field_catalog()}

    assert catalog["auth.allow_registration"].source == ConfigSource.DEFAULT
    assert catalog["auth.allow_registration"].value is True

    AppSettingRepository(session).upsert("uploads.max_upload_size_mb", 10, updated_by=None)
    session.commit()
    catalog = {field.key: field for field in service.field_catalog()}
    assert catalog["uploads.max_upload_size_mb"].source == ConfigSource.OVERRIDE
    assert catalog["uploads.max_upload_size_mb"].value == 10

    monkeypatch.setenv("OPENROUTER_DEFAULT_CHAT_MODEL", "env/model")
    get_settings.cache_clear()
    try:
        catalog = {field.key: field for field in service.field_catalog()}
        assert catalog["models.default_chat_model"].source == ConfigSource.ENV
        assert catalog["models.default_chat_model"].value == "env/model"
    finally:
        get_settings.cache_clear()


def test_apply_update_rejects_unknown_section(session: Session) -> None:
    admin = _make_admin(session)
    service = AppConfigService(session)
    with pytest.raises(InvalidInputError) as exc_info:
        service.apply_update({"bogus_section": {"x": 1}}, admin.id)
    assert "bogus_section.x" in exc_info.value.detail
