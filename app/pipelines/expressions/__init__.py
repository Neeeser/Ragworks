"""Typed expression language for pipeline variables.

Public API: `parse` source into an `Expression`, `check_type` it statically
against variable types, `evaluate` it against variable values, and
`references` to list the variables it reads. The grammar is mirrored in
TypeScript (`frontend/src/lib/expressions/`); both implementations are pinned
by the shared vectors in `tests/assets/expression_vectors.json`.
"""

from app.pipelines.expressions.analysis import check_type, references
from app.pipelines.expressions.errors import (
    ExpressionError,
    ExpressionEvalError,
    ExpressionSyntaxError,
    ExpressionTypeError,
)
from app.pipelines.expressions.evaluator import evaluate
from app.pipelines.expressions.parser import Expression, parse
from app.pipelines.expressions.values import ExprType, ExprValue, ModelValue

__all__ = [
    "ExprType",
    "ExprValue",
    "Expression",
    "ExpressionError",
    "ExpressionEvalError",
    "ExpressionSyntaxError",
    "ExpressionTypeError",
    "ModelValue",
    "check_type",
    "evaluate",
    "parse",
    "references",
]
