"""Builtin function catalog for pipeline expressions.

Every builtin is numeric-in, numeric-out. The single `BUILTINS` table is the
one place a function's name, arity, result-type rule, and behavior live — the
static checker and the evaluator both read it, so they cannot drift.

`round` rounds half away from zero (2.5 -> 3, -2.5 -> -3) rather than
Python's banker's rounding, because the TypeScript mirror must produce
identical results and half-away-from-zero is implementable identically in
both languages.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from app.pipelines.expressions.errors import ExpressionEvalError

Numeric = int | float


def _round_half_away(value: Numeric) -> int:
    """Round to the nearest integer, halves away from zero."""
    if value >= 0:
        return math.floor(value + 0.5)
    return -math.floor(-value + 0.5)


def _clamp(args: Sequence[Numeric]) -> Numeric:
    """Clamp args[0] into [args[1], args[2]], rejecting an inverted range."""
    value, low, high = args
    if low > high:
        raise ExpressionEvalError(f"clamp() range is inverted: {low} > {high}")
    return min(max(value, low), high)


@dataclass(frozen=True)
class BuiltinSpec:
    """Signature and behavior of one builtin function.

    `result` is the result-type rule: `preserve_int` yields integer when every
    argument is an integer (else number); `always_int` yields integer
    regardless of argument types.
    """

    name: str
    min_args: int
    max_args: int | None
    result: Literal["preserve_int", "always_int"]
    apply: Callable[[Sequence[Numeric]], Numeric]


BUILTINS: dict[str, BuiltinSpec] = {
    spec.name: spec
    for spec in (
        BuiltinSpec("min", 2, None, "preserve_int", min),
        BuiltinSpec("max", 2, None, "preserve_int", max),
        BuiltinSpec("clamp", 3, 3, "preserve_int", _clamp),
        BuiltinSpec("floor", 1, 1, "always_int", lambda args: math.floor(args[0])),
        BuiltinSpec("ceil", 1, 1, "always_int", lambda args: math.ceil(args[0])),
        BuiltinSpec("round", 1, 1, "always_int", lambda args: _round_half_away(args[0])),
    )
}


def arity_message(spec: BuiltinSpec, received: int) -> str:
    """Return the human-readable arity mismatch message for a builtin."""
    if spec.max_args is None:
        expected = f"at least {spec.min_args} arguments"
    elif spec.min_args == spec.max_args:
        plural = "s" if spec.min_args != 1 else ""
        expected = f"exactly {spec.min_args} argument{plural}"
    else:
        expected = f"{spec.min_args} to {spec.max_args} arguments"
    return f"{spec.name}() takes {expected}, got {received}"
