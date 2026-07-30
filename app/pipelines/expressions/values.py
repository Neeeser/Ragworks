"""Value and type domain for pipeline expressions.

Expressions are strongly typed over a small closed set of types. `integer`
promotes to `number` in arithmetic; `model` and `index` are structured
references whose members are the only member-access surface in the grammar.
Pipeline `enum` variables enter the expression layer as plain strings (their
choice constraint is enforced when the environment is built, not here).

Structured types are how a node config field points at a *choice* made
elsewhere: `emb_model.model_name` reads a provider model, `primary_index.name`
reads a registered vector index. Both dereference to strings, because config
fields take scalars.
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
    INDEX = "index"


class ModelValue(BaseModel):
    """A provider model reference: the structured (connection, model) pair."""

    model_config = ConfigDict(frozen=True)

    connection_id: UUID
    model_name: str


class IndexValue(BaseModel):
    """A registered vector index reference.

    Carries the identity a store-bound node needs — which backend, which index
    name — so a binding can repoint a pipeline at a different index (possibly
    on a different backend) without editing the definition. `index_id` is the
    `registered_indexes` row this came from; capability validation reads
    `backend` to check the referencing nodes support it.
    """

    model_config = ConfigDict(frozen=True)

    index_id: UUID
    backend: str
    name: str


ExprValue = int | float | str | bool | ModelValue | IndexValue
"""Runtime values an expression can produce or reference."""

SELF_SCOPE = "self"
"""Qualifier for a node's *own* config fields: `self.chunk_size`.

A scope, not a value — there is no `self` variable to read, and its members
are the config fields of whichever node the expression sits on, so they vary
per node rather than coming from a fixed member map. Qualifying is what makes
scope readable without knowing the node's schema, and it is why adding a
pipeline variable can never change what an existing node computes.
"""

MODEL_MEMBERS: dict[str, ExprType] = {
    "connection_id": ExprType.STRING,
    "model_name": ExprType.STRING,
}
"""Members reachable via `.` on a model-typed variable, with their types."""

INDEX_MEMBERS: dict[str, ExprType] = {
    "id": ExprType.STRING,
    "backend": ExprType.STRING,
    "name": ExprType.STRING,
}
"""Members reachable via `.` on an index-typed variable, with their types."""

MEMBERS_BY_TYPE: dict[ExprType, dict[str, ExprType]] = {
    ExprType.MODEL: MODEL_MEMBERS,
    ExprType.INDEX: INDEX_MEMBERS,
}
"""The full member-access surface, keyed by the structured type that owns it."""


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
    if isinstance(value, IndexValue):
        return ExprType.INDEX
    return ExprType.MODEL


def is_assignable(result: ExprType, expected: ExprType) -> bool:
    """Integer results satisfy number fields; everything else matches exactly."""
    return result is expected or (result is ExprType.INTEGER and expected is ExprType.NUMBER)
