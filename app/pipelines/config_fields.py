"""Read per-field facts off a node's config JSON Schema.

Node config models publish their JSON Schema through `NodeSpec.config_schema`
(the same document the editor renders forms from). Expression validation
needs two facts per field: which expression type the field accepts, and
whether it carries the `static_only` identity marker. This module owns the
little bit of JSON Schema walking that extracts them ($ref into $defs,
nullable `anyOf` flattening) so the validator stays about rules, not schema
spelunking.
"""

from __future__ import annotations

from app.pipelines.expressions import ExprType
from app.pipelines.variables import STATIC_ONLY_KEY

_SCHEMA_EXPR_TYPES: dict[str, ExprType] = {
    "integer": ExprType.INTEGER,
    "number": ExprType.NUMBER,
    "string": ExprType.STRING,
    "boolean": ExprType.BOOLEAN,
}


def field_schema(schema: dict[str, object], key: str) -> dict[str, object]:
    """Resolve one property's schema, following `$ref` and nullable `anyOf`.

    json_schema_extra (e.g. `static_only`) lands on the outer property even
    when the type lives behind anyOf/$ref, so outer keys win in the merge.
    """
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return {}
    prop = properties.get(key)
    if not isinstance(prop, dict):
        return {}
    return {**_resolve_schema(prop, schema), **prop}


def is_static_only(field: dict[str, object]) -> bool:
    """Return True when the resolved field carries the identity marker."""
    return bool(field.get(STATIC_ONLY_KEY))


def expected_expr_type(field: dict[str, object]) -> ExprType | None:
    """Map a resolved property schema to the expression type it accepts.

    Returns None when the field has no single scalar type (objects, arrays,
    non-string enums) — such fields get no static expression-type check.
    """
    if "enum" in field:
        enum_values = field.get("enum")
        if isinstance(enum_values, list) and all(
            isinstance(item, str) for item in enum_values
        ):
            return ExprType.STRING
        return None
    schema_type = field.get("type")
    if isinstance(schema_type, str):
        return _SCHEMA_EXPR_TYPES.get(schema_type)
    return None


def _resolve_schema(prop: dict[str, object], root: dict[str, object]) -> dict[str, object]:
    """Follow a `$ref` or pick the non-null branch of a nullable `anyOf`."""
    ref = prop.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        defs = root.get("$defs")
        if isinstance(defs, dict):
            target = defs.get(ref.removeprefix("#/$defs/"))
            if isinstance(target, dict):
                return target
        return {}
    any_of = prop.get("anyOf")
    if isinstance(any_of, list):
        for candidate in any_of:
            if isinstance(candidate, dict) and candidate.get("type") != "null":
                return _resolve_schema(candidate, root)
    return prop
