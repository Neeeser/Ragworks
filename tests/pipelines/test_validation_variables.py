"""Validation of variable declarations, config expressions, and the taint rule."""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.io import RetrievalInputNode
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator
from app.pipelines.validation_variables import collect_variable_issues
from app.pipelines.variables import (
    PipelineInputArgument,
    PipelineVariable,
    VariableType,
)


def _definition(
    *,
    arguments: list[PipelineInputArgument] | None = None,
    variables: list[PipelineVariable] | None = None,
    nodes: list[PipelineNodeDefinition] | None = None,
) -> PipelineDefinition:
    input_node = PipelineNodeDefinition(
        id="input",
        type=RetrievalInputNode.type,
        name="Input",
        config={"arguments": [argument.model_dump() for argument in (arguments or [])]},
    )
    return PipelineDefinition(nodes=[input_node, *(nodes or [])], variables=variables or [])


def _issues(definition: PipelineDefinition) -> list[str]:
    return [
        issue.message for issue in collect_variable_issues(definition, default_registry())
    ]


def _codes(definition: PipelineDefinition) -> set[str]:
    return {
        issue.code or ""
        for issue in collect_variable_issues(definition, default_registry())
    }


class TestDeclarations:
    """Names, duplicates, and per-declaration semantics."""

    def test_clean_definition_has_no_issues(self) -> None:
        definition = _definition(
            arguments=[
                PipelineInputArgument(
                    name="top_k", type=VariableType.INTEGER, default=5, minimum=1, maximum=10
                )
            ],
            variables=[
                PipelineVariable(
                    name="candidates", type=VariableType.INTEGER, expression="top_k * 2"
                )
            ],
        )
        assert _issues(definition) == []

    def test_invalid_name_flagged(self) -> None:
        definition = _definition(
            variables=[PipelineVariable(name="Bad Name", type=VariableType.INTEGER, value=1)]
        )
        assert any("is invalid" in message for message in _issues(definition))

    def test_reserved_name_flagged(self) -> None:
        definition = _definition(
            variables=[PipelineVariable(name="query", type=VariableType.STRING, value="x")]
        )
        assert any("reserved" in message for message in _issues(definition))

    def test_duplicate_across_arguments_and_variables_flagged(self) -> None:
        definition = _definition(
            arguments=[
                PipelineInputArgument(name="top_k", type=VariableType.INTEGER, default=5)
            ],
            variables=[PipelineVariable(name="top_k", type=VariableType.INTEGER, value=1)],
        )
        assert any("Duplicate" in message for message in _issues(definition))

    def test_variable_needs_exactly_one_source(self) -> None:
        definition = _definition(
            variables=[PipelineVariable(name="both", type=VariableType.INTEGER)]
        )
        assert any("exactly one" in message for message in _issues(definition))

    def test_model_argument_rejected(self) -> None:
        definition = _definition(
            arguments=[PipelineInputArgument(name="emb", type=VariableType.MODEL)]
        )
        assert any("cannot be caller-supplied" in message for message in _issues(definition))

    def test_optional_argument_without_default_flagged(self) -> None:
        definition = _definition(
            arguments=[PipelineInputArgument(name="boost", type=VariableType.NUMBER)]
        )
        assert any("must declare a default" in message for message in _issues(definition))

    def test_inverted_bounds_flagged(self) -> None:
        definition = _definition(
            arguments=[
                PipelineInputArgument(
                    name="top_k", type=VariableType.INTEGER, default=5, minimum=10, maximum=1
                )
            ]
        )
        assert any("exceeds maximum" in message for message in _issues(definition))


class TestExpressions:
    """Config-expression syntax, typing, and the static-only taint rule."""

    def test_syntax_error_is_field_addressable(self) -> None:
        node = PipelineNodeDefinition(
            id="fusion",
            type="fusion.rrf",
            name="Fusion",
            config={"top_k": {"$expr": "top_k *"}},
        )
        definition = _definition(
            arguments=[
                PipelineInputArgument(name="top_k", type=VariableType.INTEGER, default=5)
            ],
            nodes=[node],
        )
        issues = collect_variable_issues(definition, default_registry())
        syntax = [issue for issue in issues if issue.code == "expression_invalid"]
        assert syntax
        assert syntax[0].node_id == "fusion"
        assert syntax[0].field == "top_k"

    def test_type_mismatch_against_field_schema(self) -> None:
        node = PipelineNodeDefinition(
            id="fusion",
            type="fusion.rrf",
            name="Fusion",
            config={"top_k": {"$expr": "'ten'"}},
        )
        assert "expression_type" in _codes(_definition(nodes=[node]))

    def test_integer_expression_satisfies_number_field(self) -> None:
        node = PipelineNodeDefinition(
            id="fusion",
            type="fusion.rrf",
            name="Fusion",
            config={"top_k": {"$expr": "2 + 3"}},
        )
        assert "expression_type" not in _codes(_definition(nodes=[node]))

    def test_unknown_variable_reference_flagged(self) -> None:
        node = PipelineNodeDefinition(
            id="fusion",
            type="fusion.rrf",
            name="Fusion",
            config={"top_k": {"$expr": "missing * 2"}},
        )
        assert "expression_invalid" in _codes(_definition(nodes=[node]))

    def test_tainted_expression_on_identity_field_rejected(self) -> None:
        node = PipelineNodeDefinition(
            id="retriever",
            type="retriever.vector",
            name="Retriever",
            config={"index_name": {"$expr": "'idx-' + suffix"}},
        )
        definition = _definition(
            arguments=[
                PipelineInputArgument(name="suffix", type=VariableType.STRING, default="a")
            ],
            nodes=[node],
        )
        issues = collect_variable_issues(definition, default_registry())
        taint = [issue for issue in issues if issue.code == "expression_static_only"]
        assert taint
        assert taint[0].node_id == "retriever"
        assert taint[0].field == "index_name"

    def test_untainted_expression_on_identity_field_allowed(self) -> None:
        node = PipelineNodeDefinition(
            id="retriever",
            type="retriever.vector",
            name="Retriever",
            config={"index_name": {"$expr": "'idx-' + suffix"}},
        )
        definition = _definition(
            variables=[
                PipelineVariable(name="suffix", type=VariableType.STRING, value="a")
            ],
            nodes=[node],
        )
        assert "expression_static_only" not in _codes(definition)

    def test_taint_propagates_through_derived_variable(self) -> None:
        node = PipelineNodeDefinition(
            id="retriever",
            type="retriever.vector",
            name="Retriever",
            config={"index_name": {"$expr": "derived"}},
        )
        definition = _definition(
            arguments=[
                PipelineInputArgument(name="suffix", type=VariableType.STRING, default="a")
            ],
            variables=[
                PipelineVariable(
                    name="derived", type=VariableType.STRING, expression="'idx-' + suffix"
                )
            ],
            nodes=[node],
        )
        assert "expression_static_only" in _codes(definition)

    def test_cycle_surfaces_as_issue(self) -> None:
        definition = _definition(
            variables=[
                PipelineVariable(name="a", type=VariableType.INTEGER, expression="b + 1"),
                PipelineVariable(name="b", type=VariableType.INTEGER, expression="a + 1"),
            ],
        )
        assert any("reference cycle" in message for message in _issues(definition))


class TestValidatorIntegration:
    """PipelineValidator folds variable issues in and keeps hooks expression-safe."""

    def test_variable_errors_fail_validation(self) -> None:
        definition = _definition(
            variables=[PipelineVariable(name="query", type=VariableType.STRING, value="x")]
        )
        result = PipelineValidator(default_registry()).validate(definition)
        assert not result.valid
        assert any("reserved" in error for error in result.errors)

    def test_node_hooks_see_resolved_configs(self) -> None:
        # An expression-configured index_name resolves before the retriever's
        # missing-index hook runs, so no false "index required" issue appears.
        node = PipelineNodeDefinition(
            id="retriever",
            type="retriever.vector",
            name="Retriever",
            config={"index_name": {"$expr": "'docs-' + suffix"}},
        )
        definition = _definition(
            variables=[
                PipelineVariable(name="suffix", type=VariableType.STRING, value="main")
            ],
            nodes=[node],
        )
        result = PipelineValidator(default_registry()).validate(definition)
        assert not any(
            issue.node_id == "retriever" and issue.field == "index_name"
            for issue in result.issues
        )

    def test_expression_free_definitions_validate_as_before(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="input", type=RetrievalInputNode.type, name="Input", config={}
                )
            ]
        )
        result = PipelineValidator(default_registry()).validate(definition)
        assert result.valid
