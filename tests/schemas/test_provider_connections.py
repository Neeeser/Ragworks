"""Validation tests for provider connection configuration schemas."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.enums import ProviderType
from app.schemas.provider_configs import (
    OLLAMA_DEFAULT_PORT,
    TEI_DEFAULT_PORT,
    CohereConnectionConfig,
    OllamaConnectionConfig,
    TEIConnectionConfig,
)


def test_provider_types_include_cohere_and_tei() -> None:
    assert ProviderType.COHERE.value == "cohere"
    assert ProviderType.TEI.value == "tei"


def test_cohere_config_requires_api_key() -> None:
    with pytest.raises(ValidationError):
        CohereConnectionConfig(api_key="")


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        # An explicit port is preserved, including one that equals the scheme's
        # own default — the user said it, so it is not ours to rewrite.
        ("http://tei:80/", "http://tei:80"),
        ("https://inference.example.test:8443", "https://inference.example.test:8443"),
        # https implies 443 and a proxied endpoint; assuming TEI's own port
        # there would break a URL that already worked.
        (" https://inference.example.test/// ", "https://inference.example.test"),
        # The two frictions: a bare host, and an http host with no port.
        ("http://tei.internal", f"http://tei.internal:{TEI_DEFAULT_PORT}"),
        ("tei.internal", f"http://tei.internal:{TEI_DEFAULT_PORT}"),
        ("tei.internal:9000", "http://tei.internal:9000"),
        # IPv6 literals and userinfo must survive the rewrite intact.
        ("http://[::1]", f"http://[::1]:{TEI_DEFAULT_PORT}"),
        ("http://[::1]:9000/", "http://[::1]:9000"),
        ("http://user:pw@tei.internal", f"http://user:pw@tei.internal:{TEI_DEFAULT_PORT}"),
    ],
)
def test_tei_config_normalizes_base_url(raw: str, normalized: str) -> None:
    config = TEIConnectionConfig(base_url=raw)

    assert config.base_url == normalized
    assert config.api_key is None


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        # The reported case: a LAN Ollama server typed without its port
        # resolved to port 80 and failed with a bare connection error.
        ("http://192.168.1.50", f"http://192.168.1.50:{OLLAMA_DEFAULT_PORT}"),
        ("192.168.1.50", f"http://192.168.1.50:{OLLAMA_DEFAULT_PORT}"),
        ("192.168.1.50:11434", "http://192.168.1.50:11434"),
        ("http://localhost:11434/", "http://localhost:11434"),
    ],
)
def test_ollama_config_normalizes_base_url(raw: str, normalized: str) -> None:
    assert OllamaConnectionConfig(base_url=raw).base_url == normalized


def test_each_provider_assumes_its_own_default_port() -> None:
    """The assumed port comes from the provider, not one shared literal."""
    assert OllamaConnectionConfig(base_url="host.test").base_url.endswith(
        f":{OLLAMA_DEFAULT_PORT}"
    )
    assert TEIConnectionConfig(base_url="host.test").base_url.endswith(f":{TEI_DEFAULT_PORT}")
    assert OLLAMA_DEFAULT_PORT != TEI_DEFAULT_PORT


@pytest.mark.parametrize("raw", ["ftp://tei.internal", "file:///models", "ws://tei.internal"])
def test_tei_config_rejects_non_http_scheme(raw: str) -> None:
    with pytest.raises(ValidationError, match="must start with http"):
        TEIConnectionConfig(base_url=raw)


@pytest.mark.parametrize("raw", ["  ", "http://", "http://tei.internal:notaport"])
def test_tei_config_rejects_unusable_url(raw: str) -> None:
    with pytest.raises(ValidationError):
        TEIConnectionConfig(base_url=raw)
