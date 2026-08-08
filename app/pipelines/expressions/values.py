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

from pydantic import BaseModel, ConfigDict, Field


class ExprType(StrEnum):
    """Static types an expression or variable can have."""

    INTEGER = "integer"
    NUMBER = "number"
    STRING = "string"
    BOOLEAN = "boolean"
    MODEL = "model"
    INDEX = "index"
    ITEM = "item"
    METADATA = "metadata"


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


class MetadataValue(BaseModel):
    """One item's metadata, read as strings by open-ended member access.

    Every member types `string` because metadata keys are the corpus's, not
    the schema's — nothing can enumerate them, so a fixed member map would
    have to be wrong. An absent key reads as the empty string rather than
    raising: a heterogeneous corpus routinely holds items that carry a key
    and items that do not, and failing the run on the second kind would make
    every metadata predicate unusable on real data.
    """

    data: dict[str, str] = Field(default_factory=dict)

    def read(self, key: str) -> str:
        """Return the metadata value under `key`, empty when it carries none."""
        return self.data.get(key, "")


class ItemValue(BaseModel):
    """The item an expression is being evaluated against.

    Its members are the facts a per-item predicate routes on: the facets the
    item actually carries (`has_*`, read off the item rather than off an
    upstream port's declaration), its text and score, and its metadata.
    """

    model_config = ConfigDict(frozen=True)

    id: str = ""
    document_id: str = ""
    text: str = ""
    text_length: int = 0
    score: float = 0.0
    has_file: bool = False
    has_text: bool = False
    has_image: bool = False
    has_embedding: bool = False
    has_score: bool = False
    metadata: MetadataValue = Field(default_factory=MetadataValue)

    def member(self, name: str) -> int | float | str | bool | MetadataValue:
        """Return one declared member's value, typed as the union it can be.

        Attribute access by name would type as `Any` and silently widen the
        evaluator's return type past the value domain it is meant to close
        over; this states the domain instead.
        """
        members: dict[str, int | float | str | bool | MetadataValue] = {
            "id": self.id,
            "document_id": self.document_id,
            "text": self.text,
            "text_length": self.text_length,
            "score": self.score,
            "has_file": self.has_file,
            "has_text": self.has_text,
            "has_image": self.has_image,
            "has_embedding": self.has_embedding,
            "has_score": self.has_score,
            "metadata": self.metadata,
        }
        return members[name]


ExprValue = int | float | str | bool | ModelValue | IndexValue | ItemValue | MetadataValue
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

ITEM_MEMBERS: dict[str, ExprType] = {
    "id": ExprType.STRING,
    "document_id": ExprType.STRING,
    "text": ExprType.STRING,
    "text_length": ExprType.INTEGER,
    "score": ExprType.NUMBER,
    "has_file": ExprType.BOOLEAN,
    "has_text": ExprType.BOOLEAN,
    "has_image": ExprType.BOOLEAN,
    "has_embedding": ExprType.BOOLEAN,
    "has_score": ExprType.BOOLEAN,
    "metadata": ExprType.METADATA,
}
"""Members reachable via `.` on an item-typed variable, with their types."""

MEMBERS_BY_TYPE: dict[ExprType, dict[str, ExprType]] = {
    ExprType.MODEL: MODEL_MEMBERS,
    ExprType.INDEX: INDEX_MEMBERS,
    ExprType.ITEM: ITEM_MEMBERS,
}
"""The fixed member-access surface, keyed by the structured type that owns it.

`metadata` is absent on purpose: its keys come from the corpus, so it is
typed by the open-key rule in `analysis.py` rather than by a member map.
"""

OPEN_MEMBER_TYPES: dict[ExprType, ExprType] = {ExprType.METADATA: ExprType.STRING}
"""Types whose members are open-ended, and what every one of them types as."""


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
    if isinstance(value, ItemValue):
        return ExprType.ITEM
    if isinstance(value, MetadataValue):
        return ExprType.METADATA
    return ExprType.MODEL


def is_assignable(result: ExprType, expected: ExprType) -> bool:
    """Integer results satisfy number fields; everything else matches exactly."""
    return result is expected or (result is ExprType.INTEGER and expected is ExprType.NUMBER)
