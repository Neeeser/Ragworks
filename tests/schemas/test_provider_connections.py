"""Validation tests for provider connection configuration schemas."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.enums import ProviderType
from app.schemas.providers import CohereConnectionConfig, TEIConnectionConfig


def test_provider_types_include_cohere_and_tei() -> None:
    assert ProviderType.COHERE.value == "cohere"
    assert ProviderType.TEI.value == "tei"


def test_cohere_config_requires_api_key() -> None:
    with pytest.raises(ValidationError):
        CohereConnectionConfig(api_key="")


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("http://tei:80/", "http://tei:80"),
        (" https://inference.example.test/// ", "https://inference.example.test"),
    ],
)
def test_tei_config_normalizes_base_url(raw: str, normalized: str) -> None:
    config = TEIConnectionConfig(base_url=raw)

    assert config.base_url == normalized
    assert config.api_key is None


def test_tei_config_rejects_non_http_url() -> None:
    with pytest.raises(ValidationError, match="must start with http"):
        TEIConnectionConfig(base_url="tei.internal:80")
