"""Metadata filters applied by retriever nodes at query time.

The wire shape is a root combinator from day one — `{"all": [conditions]}`
— so future boolean groups (`any`, nesting) extend the model instead of
migrating it; v1 semantics are the AND of every condition.

A condition's comparison value is either a literal (`value`) or the name of
a pipeline variable read at query time (`var`) — how a tool argument
("author") becomes a filter without the caller editing the pipeline.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

#: Scalar values a condition may compare against. `bool` before `int` in
#: the union so True doesn't coerce to 1.
FilterScalar = bool | int | float | str


class FilterOp(StrEnum):
    """Comparison operators — Pinecone's set minus `$or`, which both
    backends can serve."""

    EQ = "eq"
    NE = "ne"
    IN = "in"
    NIN = "nin"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    EXISTS = "exists"


_RANGE_OPS = frozenset({FilterOp.GT, FilterOp.GTE, FilterOp.LT, FilterOp.LTE})
_LIST_OPS = frozenset({FilterOp.IN, FilterOp.NIN})


class FilterCondition(BaseModel):
    """One metadata comparison.

    Exactly one of `value`/`var` is set — except `exists`, which takes
    neither. The model itself stays permissive so an in-progress editor
    draft parses (matching `RetrieverConfig.top_k`); `condition_problems`
    is the coherence check validation and run time share.
    """

    field: str = ""
    op: FilterOp = FilterOp.EQ
    value: FilterScalar | list[FilterScalar] | None = None
    var: str | None = None


def condition_problems(condition: FilterCondition) -> list[str]:
    """Reasons this condition cannot be evaluated (empty when sound)."""
    problems: list[str] = []
    if not condition.field.strip():
        problems.append("names no metadata field")
    op = condition.op
    if op is FilterOp.EXISTS:
        if condition.value is not None or condition.var is not None:
            problems.append("an 'exists' condition takes no value")
        return problems
    if (condition.value is None) == (condition.var is None):
        problems.append("takes exactly one of a literal value or a variable")
    if condition.value is not None:
        if op in _LIST_OPS and not isinstance(condition.value, list):
            problems.append(f"'{op.value}' takes a list of values")
        if op not in _LIST_OPS and isinstance(condition.value, list):
            problems.append(f"'{op.value}' takes a single value")
        if op in _RANGE_OPS and (
            isinstance(condition.value, bool) or not isinstance(condition.value, (int, float))
        ):
            problems.append(f"'{op.value}' compares numbers")
    return problems


class MetadataFilter(BaseModel):
    """Root combinator: every condition in `all` must hold."""

    all: list[FilterCondition] = Field(default_factory=list)

    def is_empty(self) -> bool:
        """True when the filter constrains nothing."""
        return not self.all
