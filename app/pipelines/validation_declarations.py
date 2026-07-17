"""Validation of variable and argument declarations.

The per-declaration half of variable validation: identifier rules, the shared
argument/variable namespace, and each declaration's own semantics (exactly one
value source, enum choices, optional-needs-default, bounds sanity). Expression
and environment checks live in `validation_variables.py`, which composes these.
"""

from __future__ import annotations

from app.pipelines.node import PipelineValidationIssue
from app.pipelines.variables import (
    RESERVED_VARIABLE_NAMES,
    PipelineInputArgument,
    PipelineVariable,
    VariableType,
    valid_variable_name,
)


def name_issues(
    name: str,
    seen: set[str],
    kind: str,
) -> list[PipelineValidationIssue]:
    """Check identifier validity, reservation, and uniqueness across the namespace."""
    issues: list[PipelineValidationIssue] = []
    if not valid_variable_name(name):
        issues.append(
            declaration_issue(
                f"{kind} name '{name}' is invalid: use lowercase letters, digits, "
                "and underscores, starting with a letter or underscore."
            )
        )
    elif name in RESERVED_VARIABLE_NAMES:
        issues.append(declaration_issue(f"{kind} name '{name}' is reserved."))
    elif name in seen:
        issues.append(declaration_issue(f"Duplicate variable or argument name '{name}'."))
    seen.add(name)
    return issues


def declaration_issue(message: str) -> PipelineValidationIssue:
    """Build a declaration-level issue (no node anchor)."""
    return PipelineValidationIssue(code="variable_invalid", message=message)


def argument_issues(argument: PipelineInputArgument) -> list[PipelineValidationIssue]:
    """Semantic checks for one input argument declaration."""
    issues: list[PipelineValidationIssue] = []
    if argument.type is VariableType.MODEL:
        issues.append(
            declaration_issue(
                f"Argument '{argument.name}': model-typed values cannot be "
                "caller-supplied; declare a model variable instead."
            )
        )
        return issues
    if argument.type is VariableType.ENUM and not argument.choices:
        issues.append(
            declaration_issue(f"Argument '{argument.name}': enum arguments need choices.")
        )
    if not argument.required and argument.default is None:
        issues.append(
            declaration_issue(
                f"Argument '{argument.name}': optional arguments must declare a default."
            )
        )
    issues.extend(bounds_issues(argument.name, argument.minimum, argument.maximum))
    return issues


def variabledeclaration_issues(
    variable: PipelineVariable,
) -> list[PipelineValidationIssue]:
    """Semantic checks for one panel variable declaration."""
    issues: list[PipelineValidationIssue] = []
    has_value = variable.value is not None
    has_expression = variable.expression is not None
    if has_value == has_expression:
        issues.append(
            declaration_issue(
                f"Variable '{variable.name}' needs exactly one of a value or an expression."
            )
        )
    if variable.type is VariableType.MODEL and has_expression:
        issues.append(
            declaration_issue(
                f"Variable '{variable.name}': model variables hold a picked model, "
                "not an expression."
            )
        )
    if variable.type is VariableType.ENUM and not variable.choices:
        issues.append(
            declaration_issue(f"Variable '{variable.name}': enum variables need choices.")
        )
    issues.extend(bounds_issues(variable.name, variable.minimum, variable.maximum))
    return issues


def bounds_issues(
    name: str,
    minimum: float | None,
    maximum: float | None,
) -> list[PipelineValidationIssue]:
    """Flag an inverted minimum/maximum pair."""
    if minimum is not None and maximum is not None and minimum > maximum:
        return [
            declaration_issue(f"'{name}': minimum {minimum:g} exceeds maximum {maximum:g}.")
        ]
    return []
