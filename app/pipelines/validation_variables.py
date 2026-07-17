"""Validation of variable declarations and config expressions.

Produces field-addressable `PipelineValidationIssue`s for everything the
shape-permissive declaration models deliberately leave unchecked: names,
duplicate declarations, constant/default literals, derived-expression typing,
reference cycles, expression syntax/typing on node config fields, and the
identity-field taint rule (a `static_only` config field must never depend on
caller input). `PipelineValidator` runs this before the per-node hooks.
"""

from __future__ import annotations

from pydantic import ValidationError

from app.pipelines.config_fields import expected_expr_type, field_schema, is_static_only
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.expressions import (
    ExpressionError,
    ExprType,
    check_type,
    parse,
    references,
)
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.nodes.io import RetrievalInputConfig, RetrievalInputNode
from app.pipelines.registry import NodeRegistry
from app.pipelines.resolution import (
    VariableResolutionError,
    build_environment,
)
from app.pipelines.variables import (
    EXPR_TYPES,
    QUERY_VARIABLE,
    RESERVED_VARIABLE_NAMES,
    PipelineInputArgument,
    PipelineVariable,
    VariableType,
    expression_source,
    valid_variable_name,
)


def collect_variable_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
) -> list[PipelineValidationIssue]:
    """Return every variable/argument/expression issue in the definition."""
    issues: list[PipelineValidationIssue] = []
    seen: set[str] = {QUERY_VARIABLE}
    arguments = _collect_arguments(definition, issues)
    for argument in arguments:
        issues.extend(_name_issues(argument.name, seen, "Argument"))
        issues.extend(_argument_issues(argument))
    for variable in definition.variables:
        issues.extend(_name_issues(variable.name, seen, "Variable"))
        issues.extend(_variable_declaration_issues(variable))
    types, tainted = _static_types(definition, arguments)
    issues.extend(_derived_expression_issues(definition.variables, types))
    issues.extend(_environment_issues(definition))
    issues.extend(_node_config_issues(definition, registry, types, tainted))
    return _dedupe(issues)


def _dedupe(issues: list[PipelineValidationIssue]) -> list[PipelineValidationIssue]:
    """Drop repeat issues: some failures surface via both the per-declaration
    checks and the whole-environment build."""
    seen: set[tuple[str | None, str, str | None, str | None]] = set()
    unique: list[PipelineValidationIssue] = []
    for issue in issues:
        key = (issue.code, issue.message, issue.node_id, issue.field)
        if key in seen:
            continue
        seen.add(key)
        unique.append(issue)
    return unique


def _collect_arguments(
    definition: PipelineDefinition,
    issues: list[PipelineValidationIssue],
) -> list[PipelineInputArgument]:
    """Gather declared arguments, flagging input nodes whose config won't parse."""
    arguments: list[PipelineInputArgument] = []
    for node in definition.nodes:
        if node.type != RetrievalInputNode.type:
            continue
        try:
            config = RetrievalInputConfig.model_validate(node.config or {})
        except ValidationError:
            issues.append(
                PipelineValidationIssue(
                    code="arguments_invalid",
                    message=f"Node '{node.id}' has a malformed arguments declaration.",
                    node_id=node.id,
                    field="arguments",
                )
            )
            continue
        arguments.extend(config.arguments)
    return arguments


def _name_issues(
    name: str,
    seen: set[str],
    kind: str,
) -> list[PipelineValidationIssue]:
    """Check identifier validity, reservation, and uniqueness across the namespace."""
    issues: list[PipelineValidationIssue] = []
    if not valid_variable_name(name):
        issues.append(
            _declaration_issue(
                f"{kind} name '{name}' is invalid: use lowercase letters, digits, "
                "and underscores, starting with a letter or underscore."
            )
        )
    elif name in RESERVED_VARIABLE_NAMES:
        issues.append(_declaration_issue(f"{kind} name '{name}' is reserved."))
    elif name in seen:
        issues.append(_declaration_issue(f"Duplicate variable or argument name '{name}'."))
    seen.add(name)
    return issues


def _declaration_issue(message: str) -> PipelineValidationIssue:
    """Build a declaration-level issue (no node anchor)."""
    return PipelineValidationIssue(code="variable_invalid", message=message)


def _argument_issues(argument: PipelineInputArgument) -> list[PipelineValidationIssue]:
    """Semantic checks for one input argument declaration."""
    issues: list[PipelineValidationIssue] = []
    if argument.type is VariableType.MODEL:
        issues.append(
            _declaration_issue(
                f"Argument '{argument.name}': model-typed values cannot be "
                "caller-supplied; declare a model variable instead."
            )
        )
        return issues
    if argument.type is VariableType.ENUM and not argument.choices:
        issues.append(
            _declaration_issue(f"Argument '{argument.name}': enum arguments need choices.")
        )
    if not argument.required and argument.default is None:
        issues.append(
            _declaration_issue(
                f"Argument '{argument.name}': optional arguments must declare a default."
            )
        )
    issues.extend(_bounds_issues(argument.name, argument.minimum, argument.maximum))
    return issues


def _variable_declaration_issues(
    variable: PipelineVariable,
) -> list[PipelineValidationIssue]:
    """Semantic checks for one panel variable declaration."""
    issues: list[PipelineValidationIssue] = []
    has_value = variable.value is not None
    has_expression = variable.expression is not None
    if has_value == has_expression:
        issues.append(
            _declaration_issue(
                f"Variable '{variable.name}' needs exactly one of a value or an expression."
            )
        )
    if variable.type is VariableType.MODEL and has_expression:
        issues.append(
            _declaration_issue(
                f"Variable '{variable.name}': model variables hold a picked model, "
                "not an expression."
            )
        )
    if variable.type is VariableType.ENUM and not variable.choices:
        issues.append(
            _declaration_issue(f"Variable '{variable.name}': enum variables need choices.")
        )
    issues.extend(_bounds_issues(variable.name, variable.minimum, variable.maximum))
    return issues


def _bounds_issues(
    name: str,
    minimum: float | None,
    maximum: float | None,
) -> list[PipelineValidationIssue]:
    """Flag an inverted minimum/maximum pair."""
    if minimum is not None and maximum is not None and minimum > maximum:
        return [
            _declaration_issue(f"'{name}': minimum {minimum:g} exceeds maximum {maximum:g}.")
        ]
    return []


def _static_types(
    definition: PipelineDefinition,
    arguments: list[PipelineInputArgument],
) -> tuple[dict[str, ExprType], frozenset[str]]:
    """Build the static type environment and the tainted-name closure.

    Taint starts at input arguments and propagates through derived variables
    by iterating to a fixpoint (reference chains are short; cycles are
    reported separately and simply stop expanding).
    """
    types: dict[str, ExprType] = {QUERY_VARIABLE: ExprType.STRING}
    for argument in arguments:
        types.setdefault(argument.name, EXPR_TYPES[argument.type])
    for variable in definition.variables:
        types.setdefault(variable.name, EXPR_TYPES[variable.type])

    tainted: set[str] = {argument.name for argument in arguments}
    tainted.add(QUERY_VARIABLE)
    derived_refs: dict[str, frozenset[str]] = {}
    for variable in definition.variables:
        if variable.expression is None:
            continue
        try:
            derived_refs[variable.name] = references(parse(variable.expression))
        except ExpressionError:
            continue
    changed = True
    while changed:
        changed = False
        for name, refs in derived_refs.items():
            if name not in tainted and refs & tainted:
                tainted.add(name)
                changed = True
    return types, frozenset(tainted)


def _derived_expression_issues(
    variables: list[PipelineVariable],
    types: dict[str, ExprType],
) -> list[PipelineValidationIssue]:
    """Parse and type-check each derived variable against its declaration."""
    issues: list[PipelineValidationIssue] = []
    for variable in variables:
        if variable.expression is None:
            continue
        try:
            expression = parse(variable.expression)
            result = check_type(expression, types)
        except ExpressionError as error:
            issues.append(
                PipelineValidationIssue(
                    code="expression_invalid",
                    message=f"Variable '{variable.name}': {error.message}.",
                )
            )
            continue
        declared = EXPR_TYPES[variable.type]
        if not _assignable(result, declared):
            issues.append(
                PipelineValidationIssue(
                    code="expression_type",
                    message=(
                        f"Variable '{variable.name}' is declared {variable.type} "
                        f"but its expression evaluates to {result}."
                    ),
                )
            )
    return issues


def _environment_issues(definition: PipelineDefinition) -> list[PipelineValidationIssue]:
    """Run the real static environment build and surface its failures.

    This catches whole-environment problems individual checks cannot see in
    isolation: reference cycles, constants whose literals violate their own
    declaration, and derived results breaking their constraints.
    """
    try:
        build_environment(definition, static_defaults=True)
    except VariableResolutionError as error:
        return [
            PipelineValidationIssue(code="variable_invalid", message=message)
            for message in error.messages
        ]
    return []


def _node_config_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    types: dict[str, ExprType],
    tainted: frozenset[str],
) -> list[PipelineValidationIssue]:
    """Check every `$expr` config value: syntax, typing, and the taint rule."""
    issues: list[PipelineValidationIssue] = []
    for node in definition.nodes:
        spec = registry.get_spec(node.type)
        schema = spec.config_schema if spec else {}
        for key, value in node.config.items():
            source = expression_source(value)
            if source is None:
                continue
            issues.extend(
                _config_expression_issues(node, key, source, schema, types, tainted)
            )
    return issues


def _config_expression_issues(  # pylint: disable=too-many-arguments,too-many-positional-arguments
    node: PipelineNodeDefinition,
    key: str,
    source: str,
    schema: dict[str, object],
    types: dict[str, ExprType],
    tainted: frozenset[str],
) -> list[PipelineValidationIssue]:
    """Validate a single config-field expression."""
    try:
        expression = parse(source)
        result = check_type(expression, types)
    except ExpressionError as error:
        return [
            PipelineValidationIssue(
                code="expression_invalid",
                message=f"Node '{node.id}' field '{key}': {error.message}.",
                node_id=node.id,
                field=key,
            )
        ]
    issues: list[PipelineValidationIssue] = []
    resolved_field = field_schema(schema, key)
    expected = expected_expr_type(resolved_field)
    if expected is not None and not _assignable(result, expected):
        issues.append(
            PipelineValidationIssue(
                code="expression_type",
                message=(
                    f"Node '{node.id}' field '{key}' expects {expected} "
                    f"but the expression evaluates to {result}."
                ),
                node_id=node.id,
                field=key,
            )
        )
    if is_static_only(resolved_field) and references(expression) & tainted:
        names = ", ".join(sorted(references(expression) & tainted))
        issues.append(
            PipelineValidationIssue(
                code="expression_static_only",
                message=(
                    f"Node '{node.id}' field '{key}' identifies infrastructure and "
                    f"cannot depend on caller input (via: {names}). Use constants "
                    "or variables derived from constants."
                ),
                node_id=node.id,
                field=key,
            )
        )
    return issues


def _assignable(result: ExprType, expected: ExprType) -> bool:
    """Integer results satisfy number fields; everything else matches exactly."""
    return result is expected or (
        result is ExprType.INTEGER and expected is ExprType.NUMBER
    )
