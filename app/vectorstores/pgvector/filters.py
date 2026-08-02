"""Translate `MetadataFilter` into SQL over the `metadata` jsonb column.

Field names and values always travel as bound parameters — the dynamic part
of the SQL is only operators and parameter placeholders, so a filter can
never inject into the statement. Equality compares jsonb-to-jsonb
(`metadata -> :k = to_jsonb(:v)`) so types stay honest; range comparisons
guard on `jsonb_typeof = 'number'` so a text value in one row degrades to
non-matching instead of erroring the whole query.
"""

from __future__ import annotations

from typing import Any

from app.schemas.metadata_filter import FilterCondition, FilterOp, MetadataFilter

_RANGE_SQL = {
    FilterOp.GT: ">",
    FilterOp.GTE: ">=",
    FilterOp.LT: "<",
    FilterOp.LTE: "<=",
}


def filter_clause(
    metadata_filter: MetadataFilter | None,
) -> tuple[str, dict[str, Any]]:
    """Return `(sql, params)` for a filter: SQL starts with ` AND ` or is empty.

    The fragment references the querying statement's `metadata` column and
    is appended to a WHERE clause that already constrains `namespace`.
    """
    if metadata_filter is None or metadata_filter.is_empty():
        return "", {}
    fragments: list[str] = []
    params: dict[str, Any] = {}
    for position, condition in enumerate(metadata_filter.all):
        fragment = _condition_sql(condition, position, params)
        fragments.append(fragment)
    return " AND " + " AND ".join(fragments), params


def _condition_sql(condition: FilterCondition, position: int, params: dict[str, Any]) -> str:
    field_param = f"mf_field_{position}"
    value_param = f"mf_value_{position}"
    params[field_param] = condition.field
    op = condition.op
    if op is FilterOp.EXISTS:
        return f"metadata ? :{field_param}"
    value = condition.value
    if op in (FilterOp.IN, FilterOp.NIN):
        entries = value if isinstance(value, list) else [value]
        placeholders = []
        for index, entry in enumerate(entries):
            entry_param = f"{value_param}_{index}"
            params[entry_param] = entry
            placeholders.append(_jsonb_expr(entry_param, entry))
        membership = f"metadata -> :{field_param} IN ({', '.join(placeholders)})"
        if op is FilterOp.NIN:
            # NOT IN over jsonb treats a missing key (SQL NULL) as unknown;
            # a chunk without the field should pass a "not in" filter.
            return f"(metadata -> :{field_param} IS NULL OR NOT ({membership}))"
        return membership
    params[value_param] = value
    if op is FilterOp.EQ:
        return f"metadata -> :{field_param} = {_jsonb_expr(value_param, value)}"
    if op is FilterOp.NE:
        return (
            f"(metadata -> :{field_param} IS NULL OR "
            f"metadata -> :{field_param} <> {_jsonb_expr(value_param, value)})"
        )
    comparison = _RANGE_SQL[op]
    return (
        f"(jsonb_typeof(metadata -> :{field_param}) = 'number' AND "
        f"(metadata ->> :{field_param})::numeric {comparison} :{value_param})"
    )


def _jsonb_expr(param_name: str, value: object) -> str:
    """A `to_jsonb` expression with an explicit cast for the bound value.

    `to_jsonb` is polymorphic, so an untyped parameter placeholder cannot
    resolve it — the cast pins the SQL type the Python value carries.
    """
    if isinstance(value, bool):
        cast = "boolean"
    elif isinstance(value, (int, float)):
        cast = "numeric"
    else:
        cast = "text"
    return f"to_jsonb(CAST(:{param_name} AS {cast}))"
