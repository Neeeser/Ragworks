"""Pure tool-naming logic: slugging, exposed names, and collision detection.

`ensure_unique_tool_names` is the one place both bind-time checks
(`CollectionToolService.add_tool`, `PipelineService.update_pipeline`) route
through, so its behavior is pinned directly here rather than only through the
service-level tests that exercise it indirectly.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.db import models
from app.pipelines.interface import PipelineInterface
from app.services.errors import InvalidInputError
from app.services.tool_naming import (
    ensure_unique_tool_names,
    slugify_tool_name,
    tool_base_name,
    tool_exposed_name,
)


def _pipeline(name: str) -> models.Pipeline:
    return models.Pipeline(id=uuid4(), user_id=uuid4(), name=name, current_version=1)


def _interface(tool_name: str | None) -> PipelineInterface:
    return PipelineInterface(callable=True, tool_name=tool_name)


def test_slugify_reduces_to_the_provider_safe_alphabet() -> None:
    assert slugify_tool_name("FinQA Financial Reports!") == "finqa_financial_reports"


def test_tool_base_name_defaults_to_search_when_undeclared() -> None:
    assert tool_base_name(_interface(None)) == "search"
    assert tool_base_name(_interface("   ")) == "search"


def test_tool_base_name_uses_the_declared_name() -> None:
    assert tool_base_name(_interface("Count Documents")) == "count_documents"


def test_tool_exposed_name_namespaces_by_collection() -> None:
    assert tool_exposed_name("search", "FinQA Reports") == "search_finqa_reports"


def test_ensure_unique_tool_names_passes_distinct_names() -> None:
    ensure_unique_tool_names(
        [
            (_pipeline("A"), _interface("search")),
            (_pipeline("B"), _interface("count_documents")),
        ]
    )  # no raise


def test_ensure_unique_tool_names_rejects_a_collision_naming_both_pipelines() -> None:
    first = _pipeline("First Search")
    second = _pipeline("Second Search")

    with pytest.raises(InvalidInputError) as exc_info:
        ensure_unique_tool_names(
            [(first, _interface(None)), (second, _interface(None))]
        )

    message = str(exc_info.value)
    assert "First Search" in message
    assert "Second Search" in message
    assert "search" in message
    assert "tool_name" in message


def test_ensure_unique_tool_names_collides_on_the_default_and_an_explicit_match() -> None:
    """An unset tool_name and an explicit `"search"` are the same identity."""
    first = _pipeline("Default")
    second = _pipeline("Explicit")

    with pytest.raises(InvalidInputError):
        ensure_unique_tool_names(
            [(first, _interface(None)), (second, _interface("search"))]
        )
