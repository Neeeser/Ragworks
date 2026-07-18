"""Variable environment building and definition resolution."""

from __future__ import annotations

from uuid import UUID

import pytest

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.expressions import ExprType
from app.pipelines.nodes.io import RetrievalInputNode
from app.pipelines.resolution import (
    VariableResolutionError,
    build_environment,
    declared_arguments,
    default_environment,
    resolve_definition,
    strip_expressions,
)
from app.pipelines.variables import (
    PipelineInputArgument,
    PipelineVariable,
    VariableSource,
    VariableType,
)

CONNECTION_ID = UUID("6f9619ff-8b86-4d01-b42d-00cf4fc964ff")


def _input_variable(argument: PipelineInputArgument) -> PipelineVariable:
    """Project the argument shape back onto an input-source variable."""
    return PipelineVariable(
        name=argument.name,
        type=argument.type,
        source=VariableSource.INPUT,
        description=argument.description,
        value=None if argument.required else argument.default,
        minimum=argument.minimum,
        maximum=argument.maximum,
        choices=list(argument.choices),
        expose_to_llm=argument.expose_to_llm,
    )


def _definition(
    *,
    arguments: list[PipelineInputArgument] | None = None,
    variables: list[PipelineVariable] | None = None,
    nodes: list[PipelineNodeDefinition] | None = None,
) -> PipelineDefinition:
    """Build a definition whose input node accepts `arguments` as input variables."""
    input_node = PipelineNodeDefinition(
        id="input",
        type=RetrievalInputNode.type,
        name="Input",
        config={"arguments": [argument.name for argument in (arguments or [])]},
    )
    return PipelineDefinition(
        nodes=[input_node, *(nodes or [])],
        variables=[
            *(_input_variable(argument) for argument in (arguments or [])),
            *(variables or []),
        ],
    )


def _top_k_argument(**overrides: object) -> PipelineInputArgument:
    defaults: dict[str, object] = {
        "name": "top_k",
        "type": VariableType.INTEGER,
        "default": 5,
        "minimum": 1,
        "maximum": 10,
    }
    defaults.update(overrides)
    return PipelineInputArgument.model_validate(defaults)


class TestBuildEnvironment:
    """Environment assembly from arguments, defaults, and panel variables."""

    def test_query_is_always_present(self) -> None:
        env = build_environment(_definition(), query="coffee")
        assert env.values["query"] == "coffee"
        assert env.types["query"] is ExprType.STRING

    def test_supplied_argument_overrides_default(self) -> None:
        env = build_environment(
            _definition(arguments=[_top_k_argument()]),
            query="q",
            supplied={"top_k": 8},
        )
        assert env.values["top_k"] == 8

    def test_default_used_when_not_supplied(self) -> None:
        env = build_environment(_definition(arguments=[_top_k_argument()]), query="q")
        assert env.values["top_k"] == 5

    def test_request_top_k_feeds_declared_argument(self) -> None:
        env = build_environment(
            _definition(arguments=[_top_k_argument(name="result_limit")]),
            query="q",
            request_top_k=7,
        )
        assert env.values["result_limit"] == 7

    def test_supplied_wins_over_request_top_k(self) -> None:
        env = build_environment(
            _definition(arguments=[_top_k_argument(name="result_limit")]),
            query="q",
            supplied={"result_limit": 3},
            request_top_k=7,
        )
        assert env.values["result_limit"] == 3

    def test_arguments_are_tainted(self) -> None:
        env = build_environment(_definition(arguments=[_top_k_argument()]), query="q")
        assert "top_k" in env.tainted
        assert "query" in env.tainted

    def test_unknown_argument_rejected(self) -> None:
        with pytest.raises(VariableResolutionError, match="Unknown argument 'nope'"):
            build_environment(_definition(), query="q", supplied={"nope": 1})

    def test_missing_required_argument_rejected(self) -> None:
        argument = _top_k_argument(
            name="mode",
            type=VariableType.STRING,
            default=None,
            minimum=None,
            maximum=None,
            required=True,
        )
        with pytest.raises(VariableResolutionError, match="Missing required argument 'mode'"):
            build_environment(_definition(arguments=[argument]), query="q")

    def test_constraint_violation_rejected(self) -> None:
        with pytest.raises(VariableResolutionError, match="at most 10"):
            build_environment(
                _definition(arguments=[_top_k_argument()]),
                query="q",
                supplied={"top_k": 50},
            )

    def test_wrong_type_rejected(self) -> None:
        with pytest.raises(VariableResolutionError, match="expected a number"):
            build_environment(
                _definition(arguments=[_top_k_argument()]),
                query="q",
                supplied={"top_k": "lots"},
            )

    def test_enum_argument_enforces_choices(self) -> None:
        argument = PipelineInputArgument(
            name="mode",
            type=VariableType.ENUM,
            default="fast",
            choices=["fast", "deep"],
        )
        with pytest.raises(VariableResolutionError, match="expected one of: fast, deep"):
            build_environment(
                _definition(arguments=[argument]), query="q", supplied={"mode": "slow"}
            )

    def test_integral_float_coerces_to_int(self) -> None:
        env = build_environment(
            _definition(arguments=[_top_k_argument()]),
            query="q",
            supplied={"top_k": 5.0},
        )
        assert env.values["top_k"] == 5
        assert isinstance(env.values["top_k"], int)


class TestPanelVariables:
    """Constants and derived variables."""

    def test_constant_and_derived_evaluate(self) -> None:
        definition = _definition(
            arguments=[_top_k_argument()],
            variables=[
                PipelineVariable(name="factor", type=VariableType.INTEGER, value=3),
                PipelineVariable(
                    name="candidates",
                    type=VariableType.INTEGER,
                    expression="top_k * factor",
                ),
            ],
        )
        env = build_environment(definition, query="q", supplied={"top_k": 4})
        assert env.values["candidates"] == 12

    def test_derived_chain_orders_by_dependency(self) -> None:
        definition = _definition(
            variables=[
                # Declared out of dependency order on purpose.
                PipelineVariable(name="b", type=VariableType.INTEGER, expression="a * 2"),
                PipelineVariable(name="c", type=VariableType.INTEGER, expression="b + 1"),
                PipelineVariable(name="a", type=VariableType.INTEGER, value=10),
            ],
        )
        env = build_environment(definition, query="q")
        assert env.values["c"] == 21

    def test_taint_propagates_through_derived_variables(self) -> None:
        definition = _definition(
            arguments=[_top_k_argument()],
            variables=[
                PipelineVariable(
                    name="candidates", type=VariableType.INTEGER, expression="top_k * 2"
                ),
                PipelineVariable(name="untainted", type=VariableType.INTEGER, value=7),
            ],
        )
        env = build_environment(definition, query="q")
        assert "candidates" in env.tainted
        assert "untainted" not in env.tainted

    def test_cycle_reported(self) -> None:
        definition = _definition(
            variables=[
                PipelineVariable(name="a", type=VariableType.INTEGER, expression="b + 1"),
                PipelineVariable(name="b", type=VariableType.INTEGER, expression="a + 1"),
            ],
        )
        with pytest.raises(VariableResolutionError, match="reference cycle"):
            build_environment(definition, query="q")

    def test_derived_constraint_enforced(self) -> None:
        definition = _definition(
            variables=[
                PipelineVariable(
                    name="capped",
                    type=VariableType.INTEGER,
                    expression="100",
                    maximum=50,
                ),
            ],
        )
        with pytest.raises(VariableResolutionError, match="at most 50"):
            build_environment(definition, query="q")

    def test_model_constant_enters_environment(self) -> None:
        definition = _definition(
            variables=[
                PipelineVariable(
                    name="emb",
                    type=VariableType.MODEL,
                    value={"connection_id": str(CONNECTION_ID), "model_name": "mini"},
                ),
            ],
        )
        env = build_environment(definition, query="q")
        assert env.types["emb"] is ExprType.MODEL


class TestDefaultEnvironment:
    """The static environment used by validation and settings resolution."""

    def test_required_argument_gets_placeholder(self) -> None:
        argument = _top_k_argument(default=None, required=True)
        env = default_environment(_definition(arguments=[argument]))
        assert env.values["top_k"] == 1  # the declared minimum

    def test_defaults_are_used(self) -> None:
        env = default_environment(_definition(arguments=[_top_k_argument()]))
        assert env.values["top_k"] == 5


class TestResolveDefinition:
    """Expression substitution into node configs."""

    def test_expression_config_resolves_to_literal(self) -> None:
        node = PipelineNodeDefinition(
            id="limit",
            type="limit.results",
            name="Top-N",
            config={"max_results": {"$expr": "top_k * 2"}},
        )
        definition = _definition(arguments=[_top_k_argument()], nodes=[node])
        env = build_environment(definition, query="q", supplied={"top_k": 6})
        resolved = resolve_definition(definition, env)
        limit = resolved.node_map()["limit"]
        assert limit.config == {"max_results": 12}
        # The original definition is untouched.
        assert definition.node_map()["limit"].config["max_results"] == {"$expr": "top_k * 2"}

    def test_model_member_resolves_to_string(self) -> None:
        node = PipelineNodeDefinition(
            id="embed",
            type="embedder.text",
            name="Embedder",
            config={
                "connection_id": {"$expr": "emb.connection_id"},
                "model_name": {"$expr": "emb.model_name"},
            },
        )
        definition = _definition(
            variables=[
                PipelineVariable(
                    name="emb",
                    type=VariableType.MODEL,
                    value={"connection_id": str(CONNECTION_ID), "model_name": "mini"},
                ),
            ],
            nodes=[node],
        )
        resolved = resolve_definition(definition, build_environment(definition, query="q"))
        config = resolved.node_map()["embed"].config
        assert config["connection_id"] == str(CONNECTION_ID)
        assert config["model_name"] == "mini"

    def test_bare_model_reference_rejected(self) -> None:
        node = PipelineNodeDefinition(
            id="embed",
            type="embedder.text",
            name="Embedder",
            config={"model_name": {"$expr": "emb"}},
        )
        definition = _definition(
            variables=[
                PipelineVariable(
                    name="emb",
                    type=VariableType.MODEL,
                    value={"connection_id": str(CONNECTION_ID), "model_name": "mini"},
                ),
            ],
            nodes=[node],
        )
        env = build_environment(definition, query="q")
        with pytest.raises(VariableResolutionError, match="dereferenced"):
            resolve_definition(definition, env)

    def test_strip_expressions_removes_only_tagged_values(self) -> None:
        node = PipelineNodeDefinition(
            id="fusion",
            type="fusion.rrf",
            name="Fusion",
            config={"k": 42, "top_k": {"$expr": "broken +"}},
        )
        stripped = strip_expressions(_definition(nodes=[node]))
        assert stripped.node_map()["fusion"].config == {"k": 42}


def test_declared_arguments_reads_input_node_config() -> None:
    definition = _definition(arguments=[_top_k_argument()])
    arguments = declared_arguments(definition)
    assert [argument.name for argument in arguments] == ["top_k"]


def test_declared_arguments_tolerates_malformed_config() -> None:
    node = PipelineNodeDefinition(
        id="input",
        type=RetrievalInputNode.type,
        name="Input",
        config={"arguments": "garbage"},
    )
    assert declared_arguments(PipelineDefinition(nodes=[node])) == []
