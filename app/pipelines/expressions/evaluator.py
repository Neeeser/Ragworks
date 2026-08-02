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
    INDEX_MEMBERS,
    MODEL_MEMBERS,
    SELF_SCOPE,
    ExprValue,
    IndexValue,
    ModelValue,
    value_type,
)


def evaluate(
    expr: Expression,
    env: Mapping[str, ExprValue],
    self_values: Mapping[str, ExprValue] | None = None,
) -> ExprValue:
    """Evaluate the expression against `{variable name: value}`.

    `self_values` carries the *already resolved* sibling config fields of the
    node this expression sits on. The caller resolves siblings in dependency
    order, so a field reached through `self.` is always a literal by the time
    it is read here.
    """
    if isinstance(expr, (IntLiteral, NumberLiteral, StringLiteral, BooleanLiteral)):
        return expr.value
    if isinstance(expr, Name):
        if expr.name == SELF_SCOPE:
            raise ExpressionTypeError(f"'{SELF_SCOPE}' is a scope, not a value", expr.position)
        if expr.name not in env:
            raise ExpressionTypeError(f"Unknown variable '{expr.name}'", expr.position)
        return env[expr.name]
    if isinstance(expr, Member):
        return _evaluate_member(expr, env, self_values)
    if isinstance(expr, Unary):
        operand = _require_numeric(
            evaluate(expr.operand, env, self_values), "Unary '-'", expr.position
        )
        return -operand
    if isinstance(expr, Binary):
        return _evaluate_binary(expr, env, self_values)
    if isinstance(expr, Call):
        return _evaluate_call(expr, env, self_values)
    raise ExpressionTypeError("Unsupported expression node", expr.position)


def _require_numeric(value: ExprValue, context: str, position: int) -> Numeric:
    """Narrow a value to int/float or raise a typed error.

    Booleans are excluded explicitly: Python's `bool` subclasses `int`, and
    `flag * 2` must fail here exactly as it does in static checking.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ExpressionTypeError(f"{context} requires a number, got {value_type(value)}", position)
    return value


def _require_integer(value: ExprValue, op: str, position: int) -> int:
    """Narrow a value to a non-boolean int or raise a typed error."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ExpressionTypeError(f"'{op}' requires integers, got {value_type(value)}", position)
    return value


def _evaluate_member(
    expr: Member,
    env: Mapping[str, ExprValue],
    self_values: Mapping[str, ExprValue] | None = None,
) -> ExprValue:
    """Evaluate `self.<field>`, or structured member access to its string value."""
    if isinstance(expr.base, Name) and expr.base.name == SELF_SCOPE:
        if self_values is None or expr.attribute not in self_values:
            raise ExpressionTypeError(
                f"This node has no config field '{expr.attribute}'", expr.position
            )
        return self_values[expr.attribute]
    base = evaluate(expr.base, env, self_values)
    if isinstance(base, ModelValue) and expr.attribute in MODEL_MEMBERS:
        if expr.attribute == "connection_id":
            return str(base.connection_id)
        return base.model_name
    if isinstance(base, IndexValue) and expr.attribute in INDEX_MEMBERS:
        if expr.attribute == "id":
            return str(base.index_id)
        return base.backend if expr.attribute == "backend" else base.name
    raise ExpressionTypeError(
        f"Cannot access '{expr.attribute}' on {value_type(base)}", expr.position
    )


def _evaluate_binary(
    expr: Binary,
    env: Mapping[str, ExprValue],
    self_values: Mapping[str, ExprValue] | None = None,
) -> ExprValue:
    """Evaluate a binary operation, mirroring `_check_binary`'s rules."""
    left = evaluate(expr.left, env, self_values)
    right = evaluate(expr.right, env, self_values)
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


def _evaluate_call(
    expr: Call,
    env: Mapping[str, ExprValue],
    self_values: Mapping[str, ExprValue] | None = None,
) -> ExprValue:
    """Evaluate a builtin call against the shared catalog."""
    spec = BUILTINS.get(expr.name)
    if spec is None:
        raise ExpressionTypeError(f"Unknown function '{expr.name}'", expr.position)
    received = len(expr.args)
    if received < spec.min_args or (spec.max_args is not None and received > spec.max_args):
        raise ExpressionTypeError(arity_message(spec, received), expr.position)
    args = [
        _require_numeric(evaluate(arg, env, self_values), f"{spec.name}()", arg.position)
        for arg in expr.args
    ]
    try:
        return spec.apply(args)
    except ExpressionEvalError as error:
        raise ExpressionEvalError(error.message, expr.position) from error
