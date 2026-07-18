"""Static analysis for pipeline expressions: type checking and references.

`check_type` types an AST against a `{variable name: ExprType}` environment
without evaluating anything, so the editor and pipeline validation can reject
ill-typed expressions before any run. `references` lists the variables an
expression reads — the input to dependency ordering and the identity-field
taint rule.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.pipelines.expressions.errors import ExpressionTypeError
from app.pipelines.expressions.functions import BUILTINS, arity_message
from app.pipelines.expressions.parser import (
    Binary,
    BooleanLiteral,
    Call,
    Expression,
    IntLiteral,
    Member,
    Name,
    NumberLiteral,
    StringLiteral,
    Unary,
)
from app.pipelines.expressions.values import MODEL_MEMBERS, ExprType, is_numeric

_LITERAL_TYPES: dict[type[Expression], ExprType] = {
    IntLiteral: ExprType.INTEGER,
    NumberLiteral: ExprType.NUMBER,
    StringLiteral: ExprType.STRING,
    BooleanLiteral: ExprType.BOOLEAN,
}


def check_type(expr: Expression, env: Mapping[str, ExprType]) -> ExprType:
    """Return the expression's static type, raising `ExpressionTypeError` on misuse."""
    literal = _LITERAL_TYPES.get(type(expr))
    if literal is not None:
        return literal
    if isinstance(expr, Name):
        if expr.name not in env:
            raise ExpressionTypeError(f"Unknown variable '{expr.name}'", expr.position)
        return env[expr.name]
    if isinstance(expr, Member):
        return _check_member(expr, env)
    if isinstance(expr, Unary):
        operand = check_type(expr.operand, env)
        if not is_numeric(operand):
            raise ExpressionTypeError(f"Unary '-' requires a number, got {operand}", expr.position)
        return operand
    if isinstance(expr, Binary):
        return _check_binary(expr, env)
    if isinstance(expr, Call):
        return _check_call(expr, env)
    raise ExpressionTypeError("Unsupported expression node", expr.position)


def _check_member(expr: Member, env: Mapping[str, ExprType]) -> ExprType:
    """Type a member access: model variables expose a fixed member set."""
    base = check_type(expr.base, env)
    if base is not ExprType.MODEL:
        raise ExpressionTypeError(
            f"Member access requires a model variable, got {base}", expr.position
        )
    member = MODEL_MEMBERS.get(expr.attribute)
    if member is None:
        allowed = ", ".join(sorted(MODEL_MEMBERS))
        raise ExpressionTypeError(
            f"Unknown model member '{expr.attribute}' (expected one of: {allowed})",
            expr.position,
        )
    return member


def _check_binary(expr: Binary, env: Mapping[str, ExprType]) -> ExprType:
    """Type a binary operation with integer->number promotion."""
    left = check_type(expr.left, env)
    right = check_type(expr.right, env)
    if expr.op == "+" and left is ExprType.STRING and right is ExprType.STRING:
        return ExprType.STRING
    if expr.op in ("//", "%"):
        if left is ExprType.INTEGER and right is ExprType.INTEGER:
            return ExprType.INTEGER
        raise ExpressionTypeError(
            f"'{expr.op}' requires integers, got {left} and {right}", expr.position
        )
    if not is_numeric(left) or not is_numeric(right):
        raise ExpressionTypeError(
            f"'{expr.op}' cannot combine {left} and {right}", expr.position
        )
    if expr.op == "/":
        return ExprType.NUMBER
    if left is ExprType.INTEGER and right is ExprType.INTEGER:
        return ExprType.INTEGER
    return ExprType.NUMBER


def _check_call(expr: Call, env: Mapping[str, ExprType]) -> ExprType:
    """Type a builtin call: numeric arguments, arity from the catalog."""
    spec = BUILTINS.get(expr.name)
    if spec is None:
        raise ExpressionTypeError(f"Unknown function '{expr.name}'", expr.position)
    received = len(expr.args)
    if received < spec.min_args or (spec.max_args is not None and received > spec.max_args):
        raise ExpressionTypeError(arity_message(spec, received), expr.position)
    arg_types = [check_type(arg, env) for arg in expr.args]
    for arg, arg_type in zip(expr.args, arg_types, strict=True):
        if not is_numeric(arg_type):
            raise ExpressionTypeError(
                f"{spec.name}() requires numbers, got {arg_type}", arg.position
            )
    if spec.result == "always_int":
        return ExprType.INTEGER
    if all(arg_type is ExprType.INTEGER for arg_type in arg_types):
        return ExprType.INTEGER
    return ExprType.NUMBER


def references(expr: Expression) -> frozenset[str]:
    """Return every variable name the expression reads."""
    if isinstance(expr, Name):
        return frozenset((expr.name,))
    if isinstance(expr, Member):
        return references(expr.base)
    if isinstance(expr, Unary):
        return references(expr.operand)
    if isinstance(expr, Binary):
        return references(expr.left) | references(expr.right)
    if isinstance(expr, Call):
        return frozenset().union(*(references(arg) for arg in expr.args))
    return frozenset()
