"""Pipeline variable, argument, and output declarations.

Three declaration shapes power pipeline variables:

- `PipelineVariable` — a panel variable on `PipelineDefinition.variables`:
  either a constant (`value`) or derived from an expression over other
  variables and input arguments (`expression`).
- `PipelineInputArgument` — a caller-supplied argument declared on the
  `retrieval.input` node's config; the search API and the chat tool schema
  render from these.
- `PipelineOutputField` — a named expression on the `retrieval.output` node's
  config, evaluated at run end and returned beside the results.

These models are deliberately shape-permissive (no cross-field validators):
the editor round-trips in-progress definitions through `POST
/api/pipelines/validate`, which must answer with field-addressable issues,
never a 422. Semantic rules live in `app/pipelines/validation_variables.py`
and `app/pipelines/resolution.py`, sharing `coerce_literal` below.

Node configs reference variables with a tagged wire value
`{"$expr": "top_k * 2"}` — `expression_source` is the one detector.
"""

from __future__ import annotations

import re
from enum import StrEnum

from pydantic import BaseModel, Field, JsonValue, ValidationError

from app.pipelines.expressions import ExprType, ModelValue
from app.pipelines.expressions.functions import BUILTINS

EXPRESSION_KEY = "$expr"

QUERY_VARIABLE = "query"
"""Built-in retrieval argument: always present, always a string."""

VARIABLE_NAME_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$")
RESERVED_VARIABLE_NAMES = frozenset({QUERY_VARIABLE, "true", "false", *BUILTINS})

STATIC_ONLY_KEY = "static_only"
"""json_schema_extra marker for identity config fields (index names, backends,
dimensions): expressions on them must not depend on input arguments, so index
resolution and purge coverage stay deterministic. The frontend reads the same
marker off the node catalog's config schema."""

STATIC_ONLY_EXTRA: dict[str, JsonValue] = {STATIC_ONLY_KEY: True}
"""Pass as `Field(json_schema_extra=STATIC_ONLY_EXTRA)` on identity fields."""

ScalarValue = int | float | str | bool
VariableValue = ScalarValue | ModelValue


class VariableType(StrEnum):
    """Declared types for pipeline variables and input arguments."""

    INTEGER = "integer"
    NUMBER = "number"
    STRING = "string"
    BOOLEAN = "boolean"
    ENUM = "enum"
    MODEL = "model"


EXPR_TYPES: dict[VariableType, ExprType] = {
    VariableType.INTEGER: ExprType.INTEGER,
    VariableType.NUMBER: ExprType.NUMBER,
    VariableType.STRING: ExprType.STRING,
    VariableType.BOOLEAN: ExprType.BOOLEAN,
    # Enum variables are strings in expressions; the choice constraint is
    # enforced when values enter the environment, not by the type system.
    VariableType.ENUM: ExprType.STRING,
    VariableType.MODEL: ExprType.MODEL,
}


class PipelineVariable(BaseModel):
    """A pipeline-level variable: constant `value` or derived `expression`."""

    name: str = Field(max_length=64)
    type: VariableType
    description: str = ""
    value: VariableValue | None = None
    expression: str | None = None
    minimum: float | None = None
    maximum: float | None = None
    choices: list[str] = Field(default_factory=list)


class PipelineInputArgument(BaseModel):
    """A caller-supplied retrieval argument declared on `retrieval.input`.

    `required` arguments must be supplied by the caller; optional arguments
    must declare a `default` (enforced by validation) so expressions always
    have a value. `expose_to_llm` publishes the argument in the chat tool
    schema; the `model` type is panel-only and never valid here.
    """

    name: str = Field(max_length=64)
    type: VariableType = VariableType.STRING
    description: str = ""
    required: bool = False
    default: ScalarValue | None = None
    minimum: float | None = None
    maximum: float | None = None
    choices: list[str] = Field(default_factory=list)
    expose_to_llm: bool = False


class PipelineOutputField(BaseModel):
    """A named expression evaluated at run end and returned beside results."""

    name: str = Field(max_length=64)
    expression: str = ""


class VariableValueError(ValueError):
    """A literal or supplied value does not satisfy its declaration."""


def expression_source(value: object) -> str | None:
    """Return the expression source when `value` is a `{"$expr": ...}` wire tag."""
    if isinstance(value, dict) and set(value.keys()) == {EXPRESSION_KEY}:
        source = value[EXPRESSION_KEY]
        if isinstance(source, str):
            return source
    return None


def coerce_literal(
    declared: VariableType,
    value: object,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    choices: list[str] | None = None,
) -> VariableValue:
    """Validate a literal against its declaration and return the typed value.

    Used for constants, argument defaults, caller-supplied argument values,
    and derived-variable results, so every entry point enforces the same
    rules. Raises `VariableValueError` with a caller-facing message.
    """
    if declared is VariableType.MODEL:
        try:
            return ModelValue.model_validate(value)
        except ValidationError as error:
            raise VariableValueError(
                "expected a model value with connection_id and model_name"
            ) from error
    if declared is VariableType.BOOLEAN:
        if not isinstance(value, bool):
            raise VariableValueError("expected true or false")
        return value
    if declared in (VariableType.STRING, VariableType.ENUM):
        return _coerce_text(declared, value, choices)
    numeric = _coerce_numeric(declared, value)
    if minimum is not None and numeric < minimum:
        raise VariableValueError(f"must be at least {_format_bound(minimum)}")
    if maximum is not None and numeric > maximum:
        raise VariableValueError(f"must be at most {_format_bound(maximum)}")
    return numeric


def _coerce_text(declared: VariableType, value: object, choices: list[str] | None) -> str:
    """Coerce a raw value for string/enum declarations."""
    if not isinstance(value, str):
        raise VariableValueError("expected a string")
    if declared is VariableType.ENUM:
        if not choices:
            raise VariableValueError("enum has no choices declared")
        if value not in choices:
            allowed = ", ".join(choices)
            raise VariableValueError(f"expected one of: {allowed}")
    return value


def _coerce_numeric(declared: VariableType, value: object) -> int | float:
    """Coerce a raw value for integer/number declarations."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise VariableValueError("expected a number")
    if declared is VariableType.INTEGER:
        if isinstance(value, float):
            if not value.is_integer():
                raise VariableValueError("expected a whole number")
            return int(value)
        return value
    return value


def _format_bound(bound: float) -> str:
    """Render a numeric bound without a trailing `.0` for whole numbers."""
    return str(int(bound)) if bound.is_integer() else str(bound)


def valid_variable_name(name: str) -> bool:
    """Return True when `name` is a well-formed variable identifier."""
    return bool(VARIABLE_NAME_PATTERN.match(name))
