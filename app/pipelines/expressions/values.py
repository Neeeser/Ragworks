"""Value and type domain for pipeline expressions.

Expressions are strongly typed over a small closed set of types. `integer`
promotes to `number` in arithmetic; `model` is a structured provider-model
reference whose members (`connection_id`, `model_name`) are the only
member-access surface in the grammar. Pipeline `enum` variables enter the
expression layer as plain strings (their choice constraint is enforced when
the environment is built, not here).
"""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ExprType(StrEnum):
    """Static types an expression or variable can have."""

    INTEGER = "integer"
    NUMBER = "number"
    STRING = "string"
    BOOLEAN = "boolean"
    MODEL = "model"


class ModelValue(BaseModel):
    """A provider model reference: the structured (connection, model) pair."""

    model_config = ConfigDict(frozen=True)

    connection_id: UUID
    model_name: str


ExprValue = int | float | str | bool | ModelValue
"""Runtime values an expression can produce or reference."""

MODEL_MEMBERS: dict[str, ExprType] = {
    "connection_id": ExprType.STRING,
    "model_name": ExprType.STRING,
}
"""Members reachable via `.` on a model-typed variable, with their types."""


def is_numeric(expr_type: ExprType) -> bool:
    """Return True for the two arithmetic types."""
    return expr_type in (ExprType.INTEGER, ExprType.NUMBER)


def value_type(value: ExprValue) -> ExprType:
    """Return the static type of a runtime value.

    `bool` must be checked before `int` — Python's `bool` subclasses `int`,
    and letting a boolean masquerade as an integer would quietly allow
    `flag * 2` at runtime after the static checker rejected it.
    """
    if isinstance(value, bool):
        return ExprType.BOOLEAN
    if isinstance(value, int):
        return ExprType.INTEGER
    if isinstance(value, float):
        return ExprType.NUMBER
    if isinstance(value, str):
        return ExprType.STRING
    return ExprType.MODEL
