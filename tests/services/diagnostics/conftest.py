"""Fixtures for the diagnostics rule/service tests."""

from __future__ import annotations

import pytest

from app.pipelines.settings import PipelineSettings
from tests.services.diagnostics.helpers import (
    base_ingestion_settings,
    base_retrieval_settings,
)


@pytest.fixture(name="base_ingestion")
def base_ingestion_fixture() -> PipelineSettings:
    """Resolved default ingestion settings tests tweak with `replace`."""
    return base_ingestion_settings()


@pytest.fixture(name="base_retrieval")
def base_retrieval_fixture() -> PipelineSettings:
    """Resolved default retrieval settings tests tweak with `replace`."""
    return base_retrieval_settings()
