"""Static analysis for pipeline expressions: type checking and references.

`check_type` types an AST against a `{variable name: ExprType}` environment
without evaluating anything, so the editor and pipeline validation can reject
ill-typed expressions before any run. `references` lists the variables an
expression reads — the input to dependency ordering and the identity-field
taint rule — and `self_references` lists the sibling config fields it reads,
which is the input to *per-node* ordering and to propagating taint through a
sibling chain.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.pipelines.expressions.errors import ExpressionTypeError
from app.pipelines.expressions.functions import BUILTINS, arity_message
from app.pipelines.expressions.parser import (
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
    MEMBERS_BY_TYPE,
    OPEN_MEMBER_TYPES,
    SELF_SCOPE,
    ExprType,
    is_numeric,
)

_LITERAL_TYPES: dict[type[Expression], ExprType] = {
    IntLiteral: ExprType.INTEGER,
    NumberLiteral: ExprType.NUMBER,
    StringLiteral: ExprType.STRING,
    BooleanLiteral: ExprType.BOOLEAN,
}


def check_type(
    expr: Expression,
    env: Mapping[str, ExprType],
    self_types: Mapping[str, ExprType] | None = None,
) -> ExprType:
    """Return the expression's static type, raising `ExpressionTypeError` on misuse.

    `self_types` names the config fields of the node the expression sits on,
    reachable as `self.<field>`. Omitted, `self` is simply unknown — a bare
    expression checked outside a node has no siblings to read.
    """
    literal = _LITERAL_TYPES.get(type(expr))
    if literal is not None:
        return literal
    if isinstance(expr, Name):
        if expr.name == SELF_SCOPE:
            raise ExpressionTypeError(
                f"'{SELF_SCOPE}' is a scope, not a value — read a field with "
                f"'{SELF_SCOPE}.<field>'",
                expr.position,
            )
        if expr.name not in env:
            raise ExpressionTypeError(f"Unknown variable '{expr.name}'", expr.position)
        return env[expr.name]
    if isinstance(expr, Member):
        return _check_member(expr, env, self_types)
    if isinstance(expr, (Unary, Not)):
        return _check_unary(expr, env, self_types)
    if isinstance(expr, Binary):
        return _check_binary(expr, env, self_types)
    if isinstance(expr, Call):
        return _check_call(expr, env, self_types)
    raise ExpressionTypeError("Unsupported expression node", expr.position)


def _check_unary(
    expr: Unary | Not,
    env: Mapping[str, ExprType],
    self_types: Mapping[str, ExprType] | None = None,
) -> ExprType:
    """Type numeric negation (`-x`) or boolean negation (`not x`)."""
    operand = check_type(expr.operand, env, self_types)
    if isinstance(expr, Not):
        if operand is not ExprType.BOOLEAN:
            raise ExpressionTypeError(f"'not' requires a boolean, got {operand}", expr.position)
        return ExprType.BOOLEAN
    if not is_numeric(operand):
        raise ExpressionTypeError(f"Unary '-' requires a number, got {operand}", expr.position)
    return operand


def _check_member(
    expr: Member,
    env: Mapping[str, ExprType],
    self_types: Mapping[str, ExprType] | None = None,
) -> ExprType:
    """Type a member access: `self.<field>`, or a structured variable's members."""
    if isinstance(expr.base, Name) and expr.base.name == SELF_SCOPE:
        return _check_self_member(expr, self_types)
    base = check_type(expr.base, env, self_types)
    open_member = OPEN_MEMBER_TYPES.get(base)
    if open_member is not None:
        return open_member
    members = MEMBERS_BY_TYPE.get(base)
    if members is None:
        structured = " or ".join(sorted(MEMBERS_BY_TYPE))
        raise ExpressionTypeError(
            f"Member access requires a {structured} variable, got {base}", expr.position
        )
    member = members.get(expr.attribute)
    if member is None:
        allowed = ", ".join(sorted(members))
        raise ExpressionTypeError(
            f"Unknown {base} member '{expr.attribute}' (expected one of: {allowed})",
            expr.position,
        )
    return member


def _check_self_member(expr: Member, self_types: Mapping[str, ExprType] | None) -> ExprType:
    """Type `self.<field>` against the owning node's config fields."""
    if self_types is None:
        raise ExpressionTypeError(
            f"'{SELF_SCOPE}' is only available on a node's config field", expr.position
        )
    field_type = self_types.get(expr.attribute)
    if field_type is None:
        allowed = ", ".join(sorted(self_types)) or "none"
        raise ExpressionTypeError(
            f"This node has no config field '{expr.attribute}' (expected one of: {allowed})",
            expr.position,
        )
    return field_type


def _check_binary(
    expr: Binary,
    env: Mapping[str, ExprType],
    self_types: Mapping[str, ExprType] | None = None,
) -> ExprType:
    """Type a binary operation with integer->number promotion."""
    left = check_type(expr.left, env, self_types)
    right = check_type(expr.right, env, self_types)
    if expr.op in LOGICAL_OPERATORS:
        if left is not ExprType.BOOLEAN or right is not ExprType.BOOLEAN:
            raise ExpressionTypeError(
                f"'{expr.op}' requires booleans, got {left} and {right}", expr.position
            )
        return ExprType.BOOLEAN
    if expr.op in COMPARISON_OPERATORS:
        return _check_comparison(expr, left, right)
    if expr.op == "+" and left is ExprType.STRING and right is ExprType.STRING:
        return ExprType.STRING
    if expr.op in ("//", "%"):
        if left is ExprType.INTEGER and right is ExprType.INTEGER:
            return ExprType.INTEGER
        raise ExpressionTypeError(
            f"'{expr.op}' requires integers, got {left} and {right}", expr.position
        )
    if not is_numeric(left) or not is_numeric(right):
        raise ExpressionTypeError(f"'{expr.op}' cannot combine {left} and {right}", expr.position)
    if expr.op == "/":
        return ExprType.NUMBER
    if left is ExprType.INTEGER and right is ExprType.INTEGER:
        return ExprType.INTEGER
    return ExprType.NUMBER


def _check_comparison(expr: Binary, left: ExprType, right: ExprType) -> ExprType:
    """Type a comparison: numbers against numbers, strings against strings.

    Equality also compares two booleans; ordering does not, because `false <
    true` is an accident of representation rather than a question anyone
    means to ask. A cross-type comparison is rejected instead of answering
    `false` forever — silently-never-true is the failure mode a routing
    predicate cannot afford.
    """
    both_numeric = is_numeric(left) and is_numeric(right)
    if both_numeric or (left is ExprType.STRING and right is ExprType.STRING):
        return ExprType.BOOLEAN
    if expr.op not in ORDERING_OPERATORS and left is ExprType.BOOLEAN and right is ExprType.BOOLEAN:
        return ExprType.BOOLEAN
    raise ExpressionTypeError(
        f"'{expr.op}' cannot compare {left} and {right}", expr.position
    )


def _check_call(
    expr: Call,
    env: Mapping[str, ExprType],
    self_types: Mapping[str, ExprType] | None = None,
) -> ExprType:
    """Type a builtin call: numeric arguments, arity from the catalog."""
    spec = BUILTINS.get(expr.name)
    if spec is None:
        raise ExpressionTypeError(f"Unknown function '{expr.name}'", expr.position)
    received = len(expr.args)
    if received < spec.min_args or (spec.max_args is not None and received > spec.max_args):
        raise ExpressionTypeError(arity_message(spec, received), expr.position)
    arg_types = [check_type(arg, env, self_types) for arg in expr.args]
    for arg, arg_type in zip(expr.args, arg_types, strict=True):
        if not is_numeric(arg_type):
            raise ExpressionTypeError(
                f"{spec.name}() requires numbers, got {arg_type}", arg.position
            )
    if spec.result == "always_int":
        return ExprType.INTEGER
    if spec.result == "always_number":
        return ExprType.NUMBER
    if all(arg_type is ExprType.INTEGER for arg_type in arg_types):
        return ExprType.INTEGER
    return ExprType.NUMBER


def references(expr: Expression) -> frozenset[str]:
    """Return every *pipeline variable* name the expression reads.

    `self.<field>` is deliberately excluded: it reads a sibling config field,
    not a variable, and conflating the two would make a node look like it
    depends on a pipeline variable named `self`.
    """
    if isinstance(expr, Name):
        return frozenset() if expr.name == SELF_SCOPE else frozenset((expr.name,))
    if isinstance(expr, Member):
        if isinstance(expr.base, Name) and expr.base.name == SELF_SCOPE:
            return frozenset()
        return references(expr.base)
    if isinstance(expr, (Unary, Not)):
        return references(expr.operand)
    if isinstance(expr, Binary):
        return references(expr.left) | references(expr.right)
    if isinstance(expr, Call):
        return frozenset().union(*(references(arg) for arg in expr.args))
    return frozenset()


def self_references(expr: Expression) -> frozenset[str]:
    """Return every sibling config field the expression reads via `self.`.

    Drives per-node resolution ordering and cycle detection, and carries taint
    along a sibling chain: an identity field reading a sibling that reads
    caller input is just as request-dependent as reading the input directly.
    """
    if isinstance(expr, Member):
        if isinstance(expr.base, Name) and expr.base.name == SELF_SCOPE:
            return frozenset((expr.attribute,))
        return self_references(expr.base)
    if isinstance(expr, (Unary, Not)):
        return self_references(expr.operand)
    if isinstance(expr, Binary):
        return self_references(expr.left) | self_references(expr.right)
    if isinstance(expr, Call):
        return frozenset().union(*(self_references(arg) for arg in expr.args))
    return frozenset()
