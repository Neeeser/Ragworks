from __future__ import annotations

import os

import pytest

from app.api.config import Settings, get_settings


def test_openrouter_base_url_appends_api_version() -> None:
    settings = Settings.model_validate({"OPENROUTER_BASE_URL": "https://openrouter.ai"})

    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"


def test_openrouter_base_url_strips_trailing_slash() -> None:
    settings = Settings.model_validate({"OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1/"})

    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"


def test_openrouter_base_url_rejects_empty_value() -> None:
    with pytest.raises(ValueError, match="OPENROUTER_BASE_URL must be set"):
        Settings.model_validate({"OPENROUTER_BASE_URL": " "})


def test_database_url_rejects_non_postgres() -> None:
    with pytest.raises(ValueError, match="DATABASE_URL must use a postgres"):
        Settings.model_validate({"DATABASE_URL": "sqlite:///local.db"})


def test_get_settings_creates_storage_path(tmp_path, monkeypatch) -> None:
    get_settings.cache_clear()
    storage_path = tmp_path / "storage"
    monkeypatch.setenv("FILE_STORAGE_PATH", str(storage_path))
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://localhost:5432/transparentrag")

    settings = get_settings()

    assert settings.storage_path == storage_path
    assert storage_path.exists()

    get_settings.cache_clear()
    monkeypatch.delenv("FILE_STORAGE_PATH", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
