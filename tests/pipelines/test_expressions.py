"""Expression engine tests.

The conformance core is the shared vector file
`tests/assets/expression_vectors.json`, which the TypeScript implementation
(`frontend/src/lib/expressions/`) also executes — behavior changes must land
in the vectors, never in one implementation alone. Python-only concerns
(reference analysis, error positions) are tested separately below.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

from app.pipelines.expressions import (
    ExpressionError,
    ExpressionEvalError,
    ExpressionSyntaxError,
    ExpressionTypeError,
    ExprType,
    ExprValue,
    ModelValue,
    check_type,
    evaluate,
    parse,
    references,
)

VECTORS_PATH = Path(__file__).parent.parent / "assets" / "expression_vectors.json"
VECTORS = json.loads(VECTORS_PATH.read_text())["cases"]

_ERROR_KINDS: dict[str, type[ExpressionError]] = {
    "syntax": ExpressionSyntaxError,
    "type": ExpressionTypeError,
    "eval": ExpressionEvalError,
}


def _env_types(env: dict[str, Any]) -> dict[str, ExprType]:
    return {name: ExprType(entry["type"]) for name, entry in env.items()}


def _env_values(env: dict[str, Any]) -> dict[str, ExprValue]:
    values: dict[str, ExprValue] = {}
    for name, entry in env.items():
        if entry["type"] == "model":
            values[name] = ModelValue(
                connection_id=UUID(entry["value"]["connection_id"]),
                model_name=entry["value"]["model_name"],
            )
        else:
            values[name] = entry["value"]
    return values


@pytest.mark.parametrize("case", VECTORS, ids=[case["name"] for case in VECTORS])
def test_expression_vectors(case: dict[str, Any]) -> None:
    """Run one shared conformance vector end to end."""
    error = case.get("error")
    if error == "syntax":
        with pytest.raises(ExpressionSyntaxError):
            parse(case["source"])
        return
    expr = parse(case["source"])
    type_env = _env_types(case["env"])
    if error == "type":
        with pytest.raises(ExpressionTypeError):
            check_type(expr, type_env)
        return
    result_type = check_type(expr, type_env)
    value_env = _env_values(case["env"])
    if error == "eval":
        with pytest.raises(ExpressionEvalError):
            evaluate(expr, value_env)
        return
    expected = case["expect"]
    assert result_type is ExprType(expected["type"])
    result = evaluate(expr, value_env)
    if result_type in (ExprType.INTEGER, ExprType.NUMBER):
        assert isinstance(result, (int, float))
        assert not isinstance(result, bool)
        assert math.isclose(result, expected["value"], rel_tol=0, abs_tol=1e-9)
        if result_type is ExprType.INTEGER:
            assert isinstance(result, int)
    else:
        assert result == expected["value"]


def test_references_walks_all_node_kinds() -> None:
    """Every variable read anywhere in the tree is reported exactly once."""
    expr = parse("min(top_k * factor, cap) - -offset")
    assert references(expr) == frozenset({"top_k", "factor", "cap", "offset"})


def test_references_includes_member_base() -> None:
    """Member access reports the base variable, not the attribute."""
    expr = parse("emb_model.model_name + suffix")
    assert references(expr) == frozenset({"emb_model", "suffix"})


def test_literals_have_no_references() -> None:
    """Pure literals reference nothing."""
    assert references(parse("1 + 2.5")) == frozenset()


def test_syntax_error_reports_position() -> None:
    """Errors carry the character offset of the offending token."""
    with pytest.raises(ExpressionSyntaxError) as excinfo:
        parse("top_k * * 2")
    assert excinfo.value.position == 8


def test_type_error_reports_position_of_operator() -> None:
    """Type errors point at the operator that failed, not the whole source."""
    with pytest.raises(ExpressionTypeError) as excinfo:
        check_type(parse("1 + 'a'"), {})
    assert excinfo.value.position == 2


def test_evaluate_defends_against_untyped_env() -> None:
    """Evaluation re-checks value types even when static checking was skipped."""
    expr = parse("flag * 2")
    with pytest.raises(ExpressionTypeError):
        evaluate(expr, {"flag": True})
