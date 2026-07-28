"""The `self.<field>` scope: a config field reading its siblings on one node."""

from __future__ import annotations

import pytest

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.expressions import (
    ExpressionTypeError,
    ExprType,
    check_type,
    evaluate,
    parse,
    references,
    self_references,
)
from app.pipelines.node_scope import ConfigCycleError, resolution_order, self_dependencies
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_definition
from app.pipelines.validation_variables import collect_variable_issues
from app.pipelines.variables import RESERVED_VARIABLE_NAMES, VariableEnvironment

SELF_TYPES = {"chunk_size": ExprType.INTEGER, "tokenizer": ExprType.STRING}


def _env() -> VariableEnvironment:
    return VariableEnvironment(values={}, types={}, tainted=frozenset())


def _chunker(config: dict[str, object]) -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="chunk", type="chunker.token", name="Token Chunker", config=config
            )
        ],
        edges=[],
    )


def test_self_member_types_against_the_owning_nodes_fields() -> None:
    assert check_type(parse("self.chunk_size * 2"), {}, SELF_TYPES) is ExprType.INTEGER
    assert check_type(parse("self.tokenizer"), {}, SELF_TYPES) is ExprType.STRING


def test_unknown_sibling_field_names_the_fields_that_do_exist() -> None:
    with pytest.raises(ExpressionTypeError, match="no config field 'chunk_sizes'"):
        check_type(parse("self.chunk_sizes"), {}, SELF_TYPES)


def test_self_is_not_a_value_on_its_own() -> None:
    """Reading bare `self` would otherwise be an opaque unknown-variable error."""
    with pytest.raises(ExpressionTypeError, match="scope, not a value"):
        check_type(parse("self"), {}, SELF_TYPES)


def test_self_is_reserved_so_no_variable_can_shadow_the_scope() -> None:
    assert "self" in RESERVED_VARIABLE_NAMES


def test_self_reads_are_not_reported_as_variable_references() -> None:
    """`references` feeds the taint rule; a sibling read is not a variable."""
    expression = parse("self.chunk_size * top_k")

    assert references(expression) == frozenset({"top_k"})
    assert self_references(expression) == frozenset({"chunk_size"})


def test_resolution_order_puts_dependencies_first_regardless_of_key_order() -> None:
    """Key order is a serialization artifact and must never decide values."""
    dependencies = self_dependencies(
        {"overlap": {"$expr": "self.size * 0.2"}, "size": 512}
    )

    order = resolution_order(dependencies)

    assert order.index("size") < order.index("overlap")


def test_resolution_order_rejects_a_cycle_instead_of_recursing() -> None:
    dependencies = self_dependencies(
        {"a": {"$expr": "self.b * 2"}, "b": {"$expr": "self.a / 2"}}
    )

    with pytest.raises(ConfigCycleError, match="a, b"):
        resolution_order(dependencies)


def test_a_sibling_expression_resolves_against_the_resolved_sibling() -> None:
    definition = _chunker(
        {"chunk_size": 512, "chunk_overlap": {"$expr": "round(self.chunk_size * 0.2)"}}
    )

    resolved = resolve_definition(definition, _env())

    assert resolved.nodes[0].config == {"chunk_size": 512, "chunk_overlap": 102}


def test_a_sibling_absent_from_config_resolves_to_the_node_default() -> None:
    """The node runs with its default, so an expression must see that value."""
    definition = _chunker({"chunk_overlap": {"$expr": "round(self.chunk_size * 0.25)"}})

    resolved = resolve_definition(definition, _env())

    # chunker.token defaults chunk_size to 512.
    assert resolved.nodes[0].config["chunk_overlap"] == 128


def test_a_cycle_fails_resolution_with_the_fields_named() -> None:
    definition = _chunker({"a": {"$expr": "self.b * 2"}, "b": {"$expr": "self.a * 2"}})

    with pytest.raises(Exception, match="cycle"):
        resolve_definition(definition, _env())


def test_validation_reports_a_cycle_on_every_field_in_it(session) -> None:
    definition = _chunker(
        {
            "chunk_size": {"$expr": "self.chunk_overlap * 2"},
            "chunk_overlap": {"$expr": "self.chunk_size / 2"},
        }
    )

    issues = collect_variable_issues(definition, default_registry())

    cycles = [issue for issue in issues if issue.code == "expression_cycle"]
    assert {issue.field for issue in cycles} == {"chunk_size", "chunk_overlap"}


def test_validation_reports_an_unknown_sibling_field(session) -> None:
    definition = _chunker({"chunk_overlap": {"$expr": "self.nope * 2"}})

    issues = collect_variable_issues(definition, default_registry())

    assert any("no config field 'nope'" in issue.message for issue in issues)


def test_evaluate_reads_a_resolved_sibling() -> None:
    assert evaluate(parse("self.chunk_size + 1"), {}, {"chunk_size": 512}) == 513
