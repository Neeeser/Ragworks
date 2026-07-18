"""Validation of variable declarations.

The per-declaration half of variable validation: identifier rules, the shared
variable namespace, and each declaration's own semantics per source (value
presence, enum choices, input defaults, bounds sanity). Expression and
environment checks live in `validation_variables.py`, which composes these.
"""

from __future__ import annotations

from app.pipelines.node import PipelineValidationIssue
from app.pipelines.variables import (
    RESERVED_VARIABLE_NAMES,
    PipelineVariable,
    VariableSource,
    VariableType,
    VariableValueError,
    coerce_literal,
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


def variabledeclaration_issues(
    variable: PipelineVariable,
) -> list[PipelineValidationIssue]:
    """Semantic checks for one variable declaration, per its source."""
    issues = _enum_choice_issues(variable)
    if variable.source is VariableSource.INPUT:
        issues.extend(_input_variable_issues(variable))
        return issues
    if variable.source is VariableSource.EXPRESSION:
        if variable.expression is None:
            issues.append(
                declaration_issue(f"Variable '{variable.name}' needs an expression.")
            )
        if variable.type is VariableType.MODEL:
            issues.append(
                declaration_issue(
                    f"Variable '{variable.name}': model variables hold a picked model, "
                    "not an expression."
                )
            )
    elif variable.value is None:
        issues.append(declaration_issue(f"Variable '{variable.name}' needs a value."))
    elif variable.expression is not None:
        issues.append(
            declaration_issue(
                f"Variable '{variable.name}' needs exactly one of a value or an expression."
            )
        )
    if variable.type is VariableType.ENUM and not variable.choices:
        issues.append(
            declaration_issue(f"Variable '{variable.name}': enum variables need choices.")
        )
    issues.extend(bounds_issues(variable.name, variable.minimum, variable.maximum))
    return issues


def _enum_choice_issues(variable: PipelineVariable) -> list[PipelineValidationIssue]:
    """Reject ambiguous enum declarations before they reach keyed UI controls."""
    if variable.type is VariableType.ENUM and len(set(variable.choices)) != len(variable.choices):
        return [
            declaration_issue(
                f"Variable '{variable.name}': enum variables cannot contain duplicate choices."
            )
        ]
    return []


def _input_variable_issues(variable: PipelineVariable) -> list[PipelineValidationIssue]:
    """Semantic checks for an input-source variable declaration.

    `value` is the default; `None` means required — there is no
    optional-without-default state to flag. A default that violates the
    declaration's own constraints is caught here because input variables never
    flow through the environment build's constant check.
    """
    issues: list[PipelineValidationIssue] = []
    if variable.type is VariableType.MODEL:
        issues.append(
            declaration_issue(
                f"Variable '{variable.name}': model-typed values cannot be "
                "caller-supplied; declare a model variable instead."
            )
        )
        return issues
    if variable.expression is not None:
        issues.append(
            declaration_issue(
                f"Variable '{variable.name}': input variables take caller values, "
                "not expressions."
            )
        )
    enum_missing_choices = variable.type is VariableType.ENUM and not variable.choices
    if enum_missing_choices:
        issues.append(
            declaration_issue(f"Variable '{variable.name}': enum variables need choices.")
        )
    if variable.value is not None and not enum_missing_choices:
        try:
            coerce_literal(
                variable.type,
                variable.value,
                minimum=variable.minimum,
                maximum=variable.maximum,
                choices=variable.choices,
            )
        except VariableValueError as error:
            issues.append(declaration_issue(f"Variable '{variable.name}': default {error}."))
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
