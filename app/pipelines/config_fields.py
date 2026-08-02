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
from app.pipelines.variables import EXPR_SEED_KEY, STATIC_ONLY_KEY

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


def expr_seed(field: dict[str, object]) -> str | None:
    """Return the field's seed expression, when it declares one."""
    value = field.get(EXPR_SEED_KEY)
    return value if isinstance(value, str) else None


def integer_fields(schema: dict[str, object]) -> frozenset[str]:
    """Names of the node's integer config fields.

    Resolution rounds a number result landing on one: a proportion of an
    integer is rarely an integer (20% of 512 is 102.4), and rejecting that
    would make the natural way to write a share unusable on the very fields
    shares are written for. The rounded value is what the editor previews, so
    the author sees the stored number rather than inferring it.
    """
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return frozenset()
    return frozenset(
        key
        for key in properties
        if expected_expr_type(field_schema(schema, key)) is ExprType.INTEGER
    )


def expected_expr_type(field: dict[str, object]) -> ExprType | None:
    """Map a resolved property schema to the expression type it accepts.

    Returns None when the field has no single scalar type (objects, arrays,
    non-string enums) — such fields get no static expression-type check.
    """
    if "enum" in field:
        enum_values = field.get("enum")
        if isinstance(enum_values, list) and all(isinstance(item, str) for item in enum_values):
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
