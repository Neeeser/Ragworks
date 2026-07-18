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
from app.pipelines.nodes.io import (
    RetrievalInputConfig,
    RetrievalInputNode,
    RetrievalOutputConfig,
    RetrievalOutputNode,
)
from app.pipelines.registry import NodeRegistry
from app.pipelines.resolution import (
    VariableResolutionError,
    build_environment,
)
from app.pipelines.validation_declarations import (
    name_issues,
    variabledeclaration_issues,
)
from app.pipelines.variables import (
    EXPR_TYPES,
    QUERY_VARIABLE,
    PipelineVariable,
    VariableSource,
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
    for variable in definition.variables:
        issues.extend(name_issues(variable.name, seen, "Variable"))
        issues.extend(variabledeclaration_issues(variable))
    issues.extend(_accepted_argument_issues(definition))
    types, tainted = _static_types(definition)
    issues.extend(_derived_expression_issues(definition.variables, types))
    issues.extend(_environment_issues(definition))
    issues.extend(_node_config_issues(definition, registry, types, tainted))
    issues.extend(_output_issues(definition, types))
    return _dedupe(issues)


def _output_issues(
    definition: PipelineDefinition,
    types: dict[str, ExprType],
) -> list[PipelineValidationIssue]:
    """Check declared output expressions on retrieval.output nodes."""
    issues: list[PipelineValidationIssue] = []
    for node in definition.nodes:
        if node.type != RetrievalOutputNode.type:
            continue
        try:
            config = RetrievalOutputConfig.model_validate(node.config or {})
        except ValidationError:
            issues.append(
                PipelineValidationIssue(
                    code="outputs_invalid",
                    message=f"Node '{node.id}' has a malformed outputs declaration.",
                    node_id=node.id,
                    field="outputs",
                )
            )
            continue
        seen: set[str] = set()
        for output in config.outputs:
            message: str | None = None
            if not valid_variable_name(output.name):
                message = f"Output name '{output.name}' is invalid."
            elif output.name in seen:
                message = f"Duplicate output name '{output.name}'."
            else:
                seen.add(output.name)
                try:
                    result = check_type(parse(output.expression), types)
                    if result is ExprType.MODEL:
                        message = (
                            f"Output '{output.name}': dereference the model variable "
                            "with .connection_id or .model_name."
                        )
                except ExpressionError as error:
                    message = f"Output '{output.name}': {error.message}."
            if message is not None:
                issues.append(
                    PipelineValidationIssue(
                        code="outputs_invalid",
                        message=f"Node '{node.id}': {message}",
                        node_id=node.id,
                        field="outputs",
                    )
                )
    return issues


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


def _accepted_argument_issues(
    definition: PipelineDefinition,
) -> list[PipelineValidationIssue]:
    """Check the retrieval.input node's accepted-argument name list.

    Errors: a malformed config, or a listed name that doesn't resolve to an
    input-source variable. Warning: an input-source variable no input node
    accepts — callers can never supply it, so its default always stands in.
    """
    issues: list[PipelineValidationIssue] = []
    input_names = {
        variable.name
        for variable in definition.variables
        if variable.source is VariableSource.INPUT
    }
    accepted: set[str] = set()
    input_nodes = [node for node in definition.nodes if node.type == RetrievalInputNode.type]
    for node in input_nodes:
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
        for name in config.arguments:
            accepted.add(name)
            if name not in input_names:
                issues.append(
                    PipelineValidationIssue(
                        code="arguments_invalid",
                        message=(
                            f"Node '{node.id}' accepts '{name}', which is not a "
                            "declared input variable."
                        ),
                        node_id=node.id,
                        field="arguments",
                    )
                )
    if input_nodes:
        for name in sorted(input_names - accepted):
            issues.append(
                PipelineValidationIssue(
                    code="argument_unaccepted",
                    severity="warning",
                    message=(
                        f"Input variable '{name}' is not accepted by the retrieval "
                        "input node, so callers cannot supply it and its default "
                        "always applies."
                    ),
                )
            )
    return issues


def _static_types(
    definition: PipelineDefinition,
) -> tuple[dict[str, ExprType], frozenset[str]]:
    """Build the static type environment and the tainted-name closure.

    Taint starts at input variables and propagates through derived variables
    by iterating to a fixpoint (reference chains are short; cycles are
    reported separately and simply stop expanding).
    """
    types: dict[str, ExprType] = {QUERY_VARIABLE: ExprType.STRING}
    for variable in definition.variables:
        types.setdefault(variable.name, EXPR_TYPES[variable.type])

    tainted: set[str] = {
        variable.name
        for variable in definition.variables
        if variable.source is VariableSource.INPUT
    }
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
