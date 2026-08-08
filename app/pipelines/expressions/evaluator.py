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
from typing import TypeGuard, TypeVar

from app.pipelines.expressions.errors import ExpressionEvalError, ExpressionTypeError
from app.pipelines.expressions.functions import BUILTINS, Numeric, arity_message
from app.pipelines.expressions.parser import (
    AND_KEYWORD,
    COMPARISON_OPERATORS,
    LOGICAL_OPERATORS,
    ORDERING_OPERATORS,
    Binary,
    BooleanLiteral,
    Call,
    Expression,
    IntLiteral,
    Member,
    Name,
    Not,
    NumberLiteral,
    StringLiteral,
    Unary,
)
from app.pipelines.expressions.values import (
    INDEX_MEMBERS,
    ITEM_MEMBERS,
    MODEL_MEMBERS,
    SELF_SCOPE,
    ExprValue,
    IndexValue,
    ItemValue,
    MetadataValue,
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
    if isinstance(expr, Not):
        return not _require_boolean(
            evaluate(expr.operand, env, self_values), "not", expr.position
        )
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


def _require_boolean(value: ExprValue, op: str, position: int) -> bool:
    """Narrow a value to a bool or raise a typed error."""
    if not isinstance(value, bool):
        raise ExpressionTypeError(
            f"'{op}' requires a boolean, got {value_type(value)}", position
        )
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
    if isinstance(base, MetadataValue):
        # Open keys: an absent one reads empty, so a predicate over a key
        # only some of the corpus carries is false rather than fatal.
        return base.read(expr.attribute)
    if isinstance(base, ItemValue) and expr.attribute in ITEM_MEMBERS:
        return base.member(expr.attribute)
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
    if expr.op in LOGICAL_OPERATORS:
        return _evaluate_logical(expr, env, self_values)
    left = evaluate(expr.left, env, self_values)
    right = evaluate(expr.right, env, self_values)
    if expr.op in COMPARISON_OPERATORS:
        return _evaluate_comparison(expr, left, right)
    return _evaluate_arithmetic(expr, left, right)


def _evaluate_logical(
    expr: Binary,
    env: Mapping[str, ExprValue],
    self_values: Mapping[str, ExprValue] | None,
) -> bool:
    """Evaluate `and`/`or`, short-circuiting on the left operand.

    The right operand of `item.has_text and item.text_length > 5` is only
    meaningful where the left one held, so it is not evaluated otherwise —
    and a type error hiding in it is not reported for items the guard
    already excluded.
    """
    left = _require_boolean(evaluate(expr.left, env, self_values), expr.op, expr.position)
    if (expr.op == AND_KEYWORD) != left:
        return left
    return _require_boolean(evaluate(expr.right, env, self_values), expr.op, expr.position)


def _evaluate_arithmetic(expr: Binary, left: ExprValue, right: ExprValue) -> ExprValue:
    """Evaluate the arithmetic and string-concatenation operators."""
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


_Orderable = TypeVar("_Orderable", float, str)


def _ordered(op: str, left: _Orderable, right: _Orderable) -> bool:
    """Apply one ordering operator to two same-kind, orderable values."""
    if op == "<":
        return left < right
    if op == "<=":
        return left <= right
    if op == ">":
        return left > right
    return left >= right


def _is_number(value: ExprValue) -> TypeGuard[int | float]:
    """True for a real number — `bool` is excluded, though it subclasses `int`."""
    return not isinstance(value, bool) and isinstance(value, (int, float))


def _evaluate_comparison(expr: Binary, left: ExprValue, right: ExprValue) -> bool:
    """Compare two values, re-deriving the pairing the type checker allowed.

    Booleans compare only for equality, and never as numbers — Python's
    `bool` subclasses `int`, so an unguarded `flag < 2` would answer where
    static checking refused it.
    """
    if expr.op in ORDERING_OPERATORS:
        if isinstance(left, str) and isinstance(right, str):
            return _ordered(expr.op, left, right)
        if _is_number(left) and _is_number(right):
            return _ordered(expr.op, float(left), float(right))
    elif (
        (isinstance(left, bool) and isinstance(right, bool))
        or (isinstance(left, str) and isinstance(right, str))
        or (_is_number(left) and _is_number(right))
    ):
        return left == right if expr.op == "==" else left != right
    raise ExpressionTypeError(
        f"'{expr.op}' cannot compare {value_type(left)} and {value_type(right)}",
        expr.position,
    )


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
