"""Metadata-filter resolution (variables) and static validation."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.filtering import filter_issues, resolve_filter
from app.pipelines.variables import (
    PipelineVariable,
    VariableEnvironment,
    VariableSource,
    VariableType,
)
from app.schemas.enums import IndexBackend
from app.schemas.metadata_filter import FilterCondition, FilterOp, MetadataFilter
from app.services.errors import InvalidInputError


def _context(values: dict[str, object] | None = None) -> PipelineRunContext:
    environment = (
        VariableEnvironment(types={}, values=cast(dict, values)) if values is not None else None
    )
    return cast(
        PipelineRunContext,
        SimpleNamespace(variables=environment),
    )


class TestResolveFilter:
    def test_replaces_var_with_environment_value(self) -> None:
        metadata_filter = MetadataFilter(
            all=[FilterCondition(field="author", var="author_arg")]
        )
        resolved = resolve_filter(
            metadata_filter, _context({"author_arg": "Smith"}), node_label="Retriever"
        )
        assert resolved is not None
        assert resolved.all[0].value == "Smith"
        assert resolved.all[0].var is None

    def test_unknown_variable_is_a_domain_error(self) -> None:
        metadata_filter = MetadataFilter(all=[FilterCondition(field="a", var="missing")])
        with pytest.raises(InvalidInputError, match="missing"):
            resolve_filter(metadata_filter, _context({}), node_label="Retriever")

    def test_incoherent_condition_is_a_domain_error(self) -> None:
        metadata_filter = MetadataFilter(all=[FilterCondition(field="a")])
        with pytest.raises(InvalidInputError, match="exactly one"):
            resolve_filter(metadata_filter, _context({}), node_label="Retriever")

    def test_empty_filter_resolves_to_none(self) -> None:
        assert resolve_filter(None, _context(), node_label="R") is None
        assert resolve_filter(MetadataFilter(), _context(), node_label="R") is None


def _node() -> PipelineNodeDefinition:
    return PipelineNodeDefinition(
        id="ret-1", name="Retriever", type="retriever.vector", config={}
    )


def _definition(*variables: PipelineVariable) -> PipelineDefinition:
    return PipelineDefinition(nodes=[_node()], edges=[], variables=list(variables))


class TestFilterIssues:
    def test_undeclared_variable_is_flagged(self) -> None:
        metadata_filter = MetadataFilter(all=[FilterCondition(field="a", var="nope")])
        issues = filter_issues(
            metadata_filter, _node(), _definition(), IndexBackend.PGVECTOR,
            node_label="Retriever",
        )
        assert any("nope" in issue.message for issue in issues)

    def test_declared_variable_and_builtins_pass(self) -> None:
        variable = PipelineVariable(
            name="author_arg",
            type=VariableType.STRING,
            source=VariableSource.INPUT,
        )
        metadata_filter = MetadataFilter(
            all=[
                FilterCondition(field="a", var="author_arg"),
                FilterCondition(field="b", var="collection_id"),
            ]
        )
        issues = filter_issues(
            metadata_filter, _node(), _definition(variable), IndexBackend.PGVECTOR,
            node_label="Retriever",
        )
        assert issues == []

    def test_condition_problems_surface_as_issues(self) -> None:
        metadata_filter = MetadataFilter(
            all=[FilterCondition(field="year", op=FilterOp.GT, value="high")]
        )
        issues = filter_issues(
            metadata_filter, _node(), _definition(), IndexBackend.PGVECTOR,
            node_label="Retriever",
        )
        assert any("compares numbers" in issue.message for issue in issues)
