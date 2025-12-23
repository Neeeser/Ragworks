from __future__ import annotations

from app.api.config import Settings


def test_openrouter_base_url_appends_api_version() -> None:
    settings = Settings(openrouter_base_url="https://openrouter.ai")

    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"


def test_openrouter_base_url_strips_trailing_slash() -> None:
    settings = Settings(openrouter_base_url="https://openrouter.ai/api/v1/")

    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"
