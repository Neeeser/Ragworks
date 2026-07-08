"""Capability and index-spec validation for vector-store backends."""

from __future__ import annotations

import pytest

from app.services.errors import InvalidInputError
from app.vectorstores.base import (
    IndexSpec,
    VectorStoreCapabilities,
    validate_index_name,
    validate_index_spec,
)

CAPS = VectorStoreCapabilities(
    max_dimension=2000,
    supported_metrics=("cosine", "l2"),
    requires_api_key=False,
)


@pytest.mark.parametrize("name", ["my-index", "a", "abc123", "a1-b2-c3"])
def test_valid_index_names_pass(name: str) -> None:
    validate_index_name(name, CAPS)


@pytest.mark.parametrize(
    "name",
    [
        "My-Index",  # uppercase
        "my_index",  # underscore
        "-leading",
        "trailing-",
        "",
        "a" * 46,  # over max length
        "a; drop table users",  # injection shape
    ],
)
def test_invalid_index_names_rejected(name: str) -> None:
    with pytest.raises(InvalidInputError):
        validate_index_name(name, CAPS)


def test_valid_spec_passes() -> None:
    validate_index_spec(IndexSpec(name="docs", dimension=1536, metric="cosine"), CAPS)


def test_spec_dimension_over_backend_max_rejected() -> None:
    with pytest.raises(InvalidInputError, match="2000"):
        validate_index_spec(IndexSpec(name="docs", dimension=2001, metric="cosine"), CAPS)


def test_spec_unsupported_metric_rejected() -> None:
    with pytest.raises(InvalidInputError, match="metric"):
        validate_index_spec(IndexSpec(name="docs", dimension=8, metric="dotproduct"), CAPS)


def test_spec_bad_name_rejected() -> None:
    with pytest.raises(InvalidInputError):
        validate_index_spec(IndexSpec(name="Bad_Name", dimension=8, metric="cosine"), CAPS)


def test_spec_dimension_must_be_positive() -> None:
    with pytest.raises(ValueError):
        IndexSpec(name="docs", dimension=0, metric="cosine")
