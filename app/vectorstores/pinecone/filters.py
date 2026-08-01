"""Translate `MetadataFilter` into Pinecone's filter expression language.

One `$and` list of `{field: {"$op": value}}` clauses — uniform regardless
of condition count, so the translation has one shape to test.
"""

from __future__ import annotations

from typing import Any

from app.schemas.metadata_filter import FilterOp, MetadataFilter

_OP_NAMES = {
    FilterOp.EQ: "$eq",
    FilterOp.NE: "$ne",
    FilterOp.IN: "$in",
    FilterOp.NIN: "$nin",
    FilterOp.GT: "$gt",
    FilterOp.GTE: "$gte",
    FilterOp.LT: "$lt",
    FilterOp.LTE: "$lte",
}


def to_pinecone_filter(metadata_filter: MetadataFilter | None) -> dict[str, Any] | None:
    """Return the Pinecone filter dict, or None for an empty filter."""
    if metadata_filter is None or metadata_filter.is_empty():
        return None
    clauses: list[dict[str, Any]] = []
    for condition in metadata_filter.all:
        if condition.op is FilterOp.EXISTS:
            clauses.append({condition.field: {"$exists": True}})
            continue
        clauses.append({condition.field: {_OP_NAMES[condition.op]: condition.value}})
    return {"$and": clauses}
