"""Variable environments: the resolved values a pipeline run reads.

Before a run (and statically, for editor validation and settings resolution),
`build_environment` produces a `VariableEnvironment` from four sources:

- the built-in `query` string,
- the built-in collection descriptors (`collection_id`, `collection_name`,
  `user_id`) describing the collection the pipeline is bound to,
- every declared input argument (caller-supplied value, else default), and
  every binding-source variable (the binding's override, else its default),
- every panel variable — constants validated, derived expressions evaluated
  in dependency order.

`tainted` tracks which names derive from *caller* input; the identity-field
taint rule in `validation_variables.py` reads it. Binding values and
collection built-ins are deliberately untainted: both are fixed when a
pipeline is bound to a collection, so an index name derived from them still
resolves to one deterministic index per binding, which is what purge coverage
depends on.

Callers that accept user input catch `VariableResolutionError` and translate
it to their boundary's error type (the retrieval service maps it to
`InvalidInputError` -> 400). `app/pipelines/resolution.py` consumes these
environments to produce fully-literal definitions.
"""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import ValidationError

from app.pipelines.definition import PipelineDefinition
from app.pipelines.expressions import (
    Expression,
    ExpressionError,
    ExprType,
    ExprValue,
    check_type,
    evaluate,
    parse,
    references,
)
from app.pipelines.nodes.io import RetrievalInputConfig, RetrievalInputNode
from app.pipelines.variables import (
    EXPR_TYPES,
    QUERY_VARIABLE,
    BindingContext,
    PipelineInputArgument,
    PipelineVariable,
    VariableEnvironment,
    VariableSource,
    VariableType,
    VariableValueError,
    as_input_argument,
    coerce_literal,
)


class VariableResolutionError(ValueError):
    """One or more variable/argument/expression failures, with all messages."""

    def __init__(self, messages: list[str]) -> None:
        """Store every failure message; str() joins them."""
        super().__init__("; ".join(messages))
        self.messages = messages


def input_variables(definition: PipelineDefinition) -> dict[str, PipelineVariable]:
    """Return the definition's input-source variables by name (first wins)."""
    variables: dict[str, PipelineVariable] = {}
    for variable in definition.variables:
        if variable.source is VariableSource.INPUT and variable.name not in variables:
            variables[variable.name] = variable
    return variables


def accepted_argument_names(definition: PipelineDefinition) -> list[str]:
    """Return the variable names the retrieval.input node(s) accept, deduplicated.

    Reads config through the node's config model (never the raw dict). A
    config that does not parse contributes no names — the validator reports
    the malformed declaration separately.
    """
    names: list[str] = []
    seen: set[str] = set()
    for node in definition.nodes:
        if node.type != RetrievalInputNode.type:
            continue
        try:
            config = RetrievalInputConfig.model_validate(node.config or {})
        except ValidationError:
            continue
        for name in config.arguments:
            if name not in seen:
                seen.add(name)
                names.append(name)
    return names


def declared_arguments(definition: PipelineDefinition) -> list[PipelineInputArgument]:
    """Return the caller-facing arguments this pipeline accepts.

    Derived, never stored: the input-source variables whose names the
    `retrieval.input` node(s) list, projected onto the argument shape the
    search API and chat tool schema render from. A name with no matching
    input variable contributes nothing — the validator reports it.
    """
    variables = input_variables(definition)
    return [
        as_input_argument(variables[name])
        for name in accepted_argument_names(definition)
        if name in variables
    ]


def build_environment(
    definition: PipelineDefinition,
    *,
    query: str | None = None,
    supplied: Mapping[str, object] | None = None,
    request_top_k: int | None = None,
    static_defaults: bool = False,
    binding: BindingContext | None = None,
) -> VariableEnvironment:
    """Build the variable environment for a run.

    `request_top_k` is the external query API's established request field. When
    the pipeline accepts `result_limit` and the caller did not also supply it
    in `supplied`, that boundary value feeds the pipeline argument.
    `static_defaults=True` builds the environment validation and settings
    resolution use: required arguments get a constraint-respecting
    placeholder instead of failing.

    `binding` carries the collection descriptors the built-ins expose and the
    collection binding's overrides for binding-source variables; omitted, both
    fall back to empty so editor validation still type-checks. Neither is
    tainted — both are fixed at bind time, not per request.
    """
    errors: list[str] = []
    scope = binding or BindingContext.empty()
    types: dict[str, ExprType] = {QUERY_VARIABLE: ExprType.STRING}
    values: dict[str, ExprValue] = {QUERY_VARIABLE: query or ""}
    for builtin_name, builtin_value in scope.collection.as_values().items():
        types[builtin_name] = ExprType.STRING
        values[builtin_name] = builtin_value
    tainted: set[str] = {QUERY_VARIABLE}

    overrides = dict(scope.values)
    remaining = dict(supplied or {})
    accepted = set(accepted_argument_names(definition))
    for name, variable in input_variables(definition).items():
        if name in types:
            # Reserved-name collisions are a validation issue; the built-in wins here.
            remaining.pop(name, None)
            continue
        argument = as_input_argument(variable)
        if name in accepted:
            value = _argument_value(
                argument,
                remaining,
                request_top_k=request_top_k,
                static_defaults=static_defaults,
                errors=errors,
            )
        else:
            # Declared input but not accepted by the input node: callers can
            # never supply it (validation warns), so its default stands in.
            value = _static_placeholder(argument)
        types[name] = EXPR_TYPES[argument.type]
        tainted.add(name)
        if value is not None:
            values[name] = value
    for name in remaining:
        errors.append(f"Unknown argument '{name}'.")

    _add_binding_variables(definition.variables, overrides, types, values, errors)
    for name in overrides:
        errors.append(f"Unknown binding variable '{name}'.")

    _add_panel_variables(definition.variables, types, values, tainted, errors)

    if errors:
        raise VariableResolutionError(errors)
    return VariableEnvironment(types=types, values=values, tainted=frozenset(tainted))




def _argument_value(
    argument: PipelineInputArgument,
    remaining: dict[str, object],
    *,
    request_top_k: int | None,
    static_defaults: bool,
    errors: list[str],
) -> ExprValue | None:
    """Resolve one argument's value from supplied input, defaults, or placeholder."""
    if argument.name in remaining:
        raw: object = remaining.pop(argument.name)
    elif argument.name == "result_limit" and request_top_k is not None:
        raw = request_top_k
    elif static_defaults:
        return _static_placeholder(argument)
    elif argument.default is not None:
        raw = argument.default
    elif argument.required:
        errors.append(f"Missing required argument '{argument.name}'.")
        return None
    else:
        # Optional without a default is itself a validation issue; a
        # placeholder keeps expressions evaluable rather than crashing.
        return _static_placeholder(argument)
    try:
        return coerce_literal(
            argument.type,
            raw,
            minimum=argument.minimum,
            maximum=argument.maximum,
            choices=argument.choices,
        )
    except VariableValueError as error:
        errors.append(f"Argument '{argument.name}': {error}.")
        return None


def _static_placeholder(argument: PipelineInputArgument) -> ExprValue:
    """Return a constraint-respecting stand-in for static evaluation."""
    if argument.default is not None:
        try:
            return coerce_literal(
                argument.type,
                argument.default,
                minimum=argument.minimum,
                maximum=argument.maximum,
                choices=argument.choices,
            )
        except VariableValueError:
            pass
    if argument.type is VariableType.INTEGER:
        return int(argument.minimum) if argument.minimum is not None else 1
    if argument.type is VariableType.NUMBER:
        return argument.minimum if argument.minimum is not None else 1.0
    if argument.type is VariableType.BOOLEAN:
        return False
    if argument.type is VariableType.ENUM and argument.choices:
        return argument.choices[0]
    return ""


def _add_binding_variables(
    variables: list[PipelineVariable],
    overrides: dict[str, object],
    types: dict[str, ExprType],
    values: dict[str, ExprValue],
    errors: list[str],
) -> None:
    """Resolve binding-source variables from their overrides or defaults.

    Values are added *untainted*: a binding's choice is fixed for every run
    against that collection, so identity fields may depend on it and still
    resolve to one deterministic index per binding.
    """
    for variable in variables:
        if variable.source is not VariableSource.BINDING:
            continue
        if variable.name in types:
            overrides.pop(variable.name, None)
            continue  # reserved-name collisions are a validation issue
        types[variable.name] = EXPR_TYPES[variable.type]
        supplied = overrides.pop(variable.name, None)
        raw = supplied if supplied is not None else variable.value
        if raw is None:
            errors.append(
                f"Variable '{variable.name}' must be set for this collection."
            )
            continue
        try:
            values[variable.name] = coerce_literal(
                variable.type,
                raw,
                minimum=variable.minimum,
                maximum=variable.maximum,
                choices=variable.choices,
            )
        except VariableValueError as error:
            errors.append(f"Variable '{variable.name}': {error}.")


def _add_panel_variables(
    variables: list[PipelineVariable],
    types: dict[str, ExprType],
    values: dict[str, ExprValue],
    tainted: set[str],
    errors: list[str],
) -> None:
    """Validate constants and evaluate derived variables in dependency order."""
    declared: dict[str, PipelineVariable] = {}
    for variable in variables:
        if variable.source in (VariableSource.INPUT, VariableSource.BINDING):
            continue  # input and binding variables entered the environment first
        if variable.name in types or variable.name in declared:
            continue  # duplicates are a validation issue; the first wins here
        declared[variable.name] = variable
        types[variable.name] = EXPR_TYPES[variable.type]

    parsed: dict[str, Expression] = {}
    for name, variable in declared.items():
        if variable.expression is None:
            _add_constant(variable, values, errors)
            continue
        try:
            parsed[name] = parse(variable.expression)
        except ExpressionError as error:
            errors.append(f"Variable '{name}': {error.message}.")

    for name in _evaluation_order(parsed, errors):
        variable = declared[name]
        expression = parsed[name]
        refs = references(expression)
        if refs & tainted:
            tainted.add(name)
        try:
            check_type(expression, types)
            result = evaluate(expression, values)
            values[name] = coerce_literal(
                variable.type,
                result,
                minimum=variable.minimum,
                maximum=variable.maximum,
                choices=variable.choices,
            )
        except (ExpressionError, VariableValueError) as error:
            message = error.message if isinstance(error, ExpressionError) else str(error)
            errors.append(f"Variable '{name}': {message}.")


def _add_constant(
    variable: PipelineVariable,
    values: dict[str, ExprValue],
    errors: list[str],
) -> None:
    """Validate a constant variable's literal and add it to the environment."""
    if variable.value is None:
        errors.append(f"Variable '{variable.name}' has neither a value nor an expression.")
        return
    try:
        values[variable.name] = coerce_literal(
            variable.type,
            variable.value,
            minimum=variable.minimum,
            maximum=variable.maximum,
            choices=variable.choices,
        )
    except VariableValueError as error:
        errors.append(f"Variable '{variable.name}': {error}.")


def _evaluation_order(
    parsed: dict[str, Expression],
    errors: list[str],
) -> list[str]:
    """Order derived variables so dependencies evaluate first (Kahn's algorithm).

    Only edges between derived variables matter — arguments and constants are
    already resolved. Variables left unordered form a reference cycle.
    """
    dependencies = {
        name: references(expression) & parsed.keys() for name, expression in parsed.items()
    }
    ordered: list[str] = []
    satisfied: set[str] = set()
    pending = dict(dependencies)
    while pending:
        ready = sorted(name for name, deps in pending.items() if deps <= satisfied)
        if not ready:
            cycle = ", ".join(sorted(pending))
            errors.append(f"Variables form a reference cycle: {cycle}.")
            break
        for name in ready:
            ordered.append(name)
            satisfied.add(name)
            del pending[name]
    return ordered
