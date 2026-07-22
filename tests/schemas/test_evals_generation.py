"""Wire-contract validation for the synthetic-generation request schema.

The `EvalDatasetGenerateRequest` validators are the boundary that keeps an
unusable generation request out of the background job: a question-type mix that
can never sample, and example-query steering that is blank or oversized. These
cover the reject-and-accept branches directly.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.enums import EvalQuestionType
from app.schemas.evals_generation import EvalDatasetGenerateRequest


def _request(**overrides: object) -> EvalDatasetGenerateRequest:
    """Build a valid generate request, overriding the field under test."""
    payload: dict[str, object] = {
        "name": "Synthetic set",
        "collection_id": uuid4(),
        "connection_id": uuid4(),
        "model_name": "openai/gpt-4o-mini",
    }
    payload.update(overrides)
    return EvalDatasetGenerateRequest.model_validate(payload)


def test_rejects_negative_type_weight() -> None:
    """A negative weight is not a valid ratio and is rejected."""
    with pytest.raises(ValidationError):
        _request(type_mix={EvalQuestionType.SINGLE_FACT: -1.0})


def test_rejects_all_zero_type_mix() -> None:
    """A mix with no positive weight can never sample a question type."""
    with pytest.raises(ValidationError):
        _request(
            type_mix={
                EvalQuestionType.SINGLE_FACT: 0.0,
                EvalQuestionType.PARAPHRASED: 0.0,
                EvalQuestionType.MULTI_DETAIL: 0.0,
            }
        )


def test_rejects_overlong_example_query() -> None:
    """An example query beyond the per-entry cap is rejected."""
    with pytest.raises(ValidationError):
        _request(example_queries=["x" * 501])


def test_trims_blank_example_queries() -> None:
    """Blank entries are dropped and surviving examples are stripped."""
    request = _request(example_queries=["  how hot is the sun  ", "", "   "])
    assert request.example_queries == ["how hot is the sun"]


def test_accepts_more_than_three_example_queries() -> None:
    """Example queries are uncapped — power users tune with as many as they want."""
    examples = [f"query {index}" for index in range(8)]
    request = _request(example_queries=examples)
    assert request.example_queries == examples


def test_accepts_a_positive_partial_mix() -> None:
    """A single positive weight is a usable mix and is preserved verbatim."""
    request = _request(type_mix={EvalQuestionType.SINGLE_FACT: 2.0})
    assert request.type_mix == {EvalQuestionType.SINGLE_FACT: 2.0}
