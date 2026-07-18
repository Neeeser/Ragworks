"""Evaluator for pipeline expressions.

Evaluation is defensive rather than trusting: it re-derives value types at
runtime (environments are built from caller-supplied argument values), so a
value that slipped past static checking still fails with a typed
`ExpressionTypeError` instead of leaking Python semantics like `bool + int`.
Arithmetic failures that types cannot catch (divide by zero, inverted clamp
range) raise `ExpressionEvalError`.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.pipelines.expressions.errors import ExpressionEvalError, ExpressionTypeError
from app.pipelines.expressions.functions import BUILTINS, Numeric, arity_message
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
from app.pipelines.expressions.values import (
    MODEL_MEMBERS,
    ExprValue,
    ModelValue,
    value_type,
)


def evaluate(expr: Expression, env: Mapping[str, ExprValue]) -> ExprValue:
    """Evaluate the expression against `{variable name: value}`."""
    if isinstance(expr, (IntLiteral, NumberLiteral, StringLiteral, BooleanLiteral)):
        return expr.value
    if isinstance(expr, Name):
        if expr.name not in env:
            raise ExpressionTypeError(f"Unknown variable '{expr.name}'", expr.position)
        return env[expr.name]
    if isinstance(expr, Member):
        return _evaluate_member(expr, env)
    if isinstance(expr, Unary):
        operand = _require_numeric(evaluate(expr.operand, env), "Unary '-'", expr.position)
        return -operand
    if isinstance(expr, Binary):
        return _evaluate_binary(expr, env)
    if isinstance(expr, Call):
        return _evaluate_call(expr, env)
    raise ExpressionTypeError("Unsupported expression node", expr.position)


def _require_numeric(value: ExprValue, context: str, position: int) -> Numeric:
    """Narrow a value to int/float or raise a typed error.

    Booleans are excluded explicitly: Python's `bool` subclasses `int`, and
    `flag * 2` must fail here exactly as it does in static checking.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ExpressionTypeError(
            f"{context} requires a number, got {value_type(value)}", position
        )
    return value


def _require_integer(value: ExprValue, op: str, position: int) -> int:
    """Narrow a value to a non-boolean int or raise a typed error."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ExpressionTypeError(
            f"'{op}' requires integers, got {value_type(value)}", position
        )
    return value


def _evaluate_member(expr: Member, env: Mapping[str, ExprValue]) -> ExprValue:
    """Evaluate model member access to its string value."""
    base = evaluate(expr.base, env)
    if not isinstance(base, ModelValue) or expr.attribute not in MODEL_MEMBERS:
        raise ExpressionTypeError(
            f"Cannot access '{expr.attribute}' on {value_type(base)}", expr.position
        )
    if expr.attribute == "connection_id":
        return str(base.connection_id)
    return base.model_name


def _evaluate_binary(expr: Binary, env: Mapping[str, ExprValue]) -> ExprValue:
    """Evaluate a binary operation, mirroring `_check_binary`'s rules."""
    left = evaluate(expr.left, env)
    right = evaluate(expr.right, env)
    if expr.op == "+" and isinstance(left, str) and isinstance(right, str):
        return left + right
    if expr.op in ("//", "%"):
        left_int = _require_integer(left, expr.op, expr.position)
        right_int = _require_integer(right, expr.op, expr.position)
        if right_int == 0:
            raise ExpressionEvalError(f"'{expr.op}' by zero", expr.position)
        return left_int // right_int if expr.op == "//" else left_int % right_int
    left_num = _require_numeric(left, f"'{expr.op}'", expr.position)
    right_num = _require_numeric(right, f"'{expr.op}'", expr.position)
    if expr.op == "+":
        return left_num + right_num
    if expr.op == "-":
        return left_num - right_num
    if expr.op == "*":
        return left_num * right_num
    if right_num == 0:
        raise ExpressionEvalError("'/' by zero", expr.position)
    return left_num / right_num


def _evaluate_call(expr: Call, env: Mapping[str, ExprValue]) -> ExprValue:
    """Evaluate a builtin call against the shared catalog."""
    spec = BUILTINS.get(expr.name)
    if spec is None:
        raise ExpressionTypeError(f"Unknown function '{expr.name}'", expr.position)
    received = len(expr.args)
    if received < spec.min_args or (spec.max_args is not None and received > spec.max_args):
        raise ExpressionTypeError(arity_message(spec, received), expr.position)
    args = [
        _require_numeric(evaluate(arg, env), f"{spec.name}()", arg.position)
        for arg in expr.args
    ]
    try:
        return spec.apply(args)
    except ExpressionEvalError as error:
        raise ExpressionEvalError(error.message, expr.position) from error
