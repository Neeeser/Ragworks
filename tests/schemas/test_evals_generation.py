"""Wire-contract validation for the synthetic-generation request schema.

The `EvalDatasetGenerateRequest` validators are the boundary that keeps an
unusable generation request out of the background job: a question-type mix that
can never sample, example-query steering that is blank or oversized, and a
model map with nothing to write text questions with. The legacy-shape lift is
covered here too, because a stored `generation_config` is re-validated through
this schema every time a run resumes.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.enums import EvalModality, EvalQuestionType
from app.schemas.evals_generation import EvalDatasetGenerateRequest

_CONNECTION = uuid4()


def _request(**overrides: object) -> EvalDatasetGenerateRequest:
    """Build a valid generate request, overriding the field under test."""
    payload: dict[str, object] = {
        "name": "Synthetic set",
        "collection_id": uuid4(),
        "models": {
            "text": {"connection_id": str(_CONNECTION), "model_name": "openai/gpt-4o-mini"}
        },
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


def test_rejects_a_map_without_a_text_model() -> None:
    """Every dataset produces text questions, so a text model is mandatory."""
    with pytest.raises(ValidationError):
        _request(
            models={"image": {"connection_id": str(_CONNECTION), "model_name": "vision/model"}}
        )


def test_accepts_a_model_per_modality() -> None:
    """Each modality keeps its own connection and model."""
    other = uuid4()
    request = _request(
        models={
            "text": {"connection_id": str(_CONNECTION), "model_name": "openai/gpt-4o-mini"},
            "image": {"connection_id": str(other), "model_name": "vision/model"},
        }
    )
    assert request.models[EvalModality.TEXT].model_name == "openai/gpt-4o-mini"
    assert request.models[EvalModality.IMAGE].connection_id == other


def test_legacy_flat_model_lifts_into_the_text_entry() -> None:
    """A stored config from before the map still validates, as a text choice.

    The row's `generation_config` is re-validated whenever its run resumes,
    so reading the flat pair is what keeps those datasets generating.
    """
    request = EvalDatasetGenerateRequest.model_validate(
        {
            "name": "Older set",
            "collection_id": str(uuid4()),
            "connection_id": str(_CONNECTION),
            "model_name": "openai/gpt-4o-mini",
            "num_questions": 12,
        }
    )
    assert set(request.models) == {EvalModality.TEXT}
    assert request.models[EvalModality.TEXT].connection_id == _CONNECTION
    assert request.models[EvalModality.TEXT].model_name == "openai/gpt-4o-mini"
    assert request.num_questions == 12


def test_an_explicit_map_wins_over_stray_flat_fields() -> None:
    """A payload carrying both is read as its map; the flat pair is ignored."""
    mapped = uuid4()
    request = EvalDatasetGenerateRequest.model_validate(
        {
            "name": "Both shapes",
            "collection_id": str(uuid4()),
            "connection_id": str(_CONNECTION),
            "model_name": "legacy/model",
            "models": {"text": {"connection_id": str(mapped), "model_name": "current/model"}},
        }
    )
    assert request.models[EvalModality.TEXT].connection_id == mapped
    assert request.models[EvalModality.TEXT].model_name == "current/model"


def test_a_dumped_request_round_trips() -> None:
    """`model_dump(mode="json")` is what lands in `generation_config`."""
    request = _request()
    assert EvalDatasetGenerateRequest.model_validate(request.model_dump(mode="json")) == request
