"""Generation prompts: steering inputs land in the message, JSON contract holds."""

from __future__ import annotations

from app.evals.generation.candidates import CandidateQuestion
from app.evals.generation.prompts import (
    build_critique_messages,
    build_generation_messages,
)
from app.schemas.enums import EvalQuestionType


def _messages(**overrides: object) -> str:
    kwargs: dict = {
        "context_text": "The retry budget is two attempts.",
        "question_type": EvalQuestionType.SINGLE_FACT,
        "candidates_per_context": 3,
        "audience": None,
        "example_queries": [],
        "distractor_texts": [],
    }
    kwargs.update(overrides)
    messages = build_generation_messages(**kwargs)
    assert messages[0]["role"] == "system"
    return messages[1]["content"]


def test_optional_steering_inputs_shape_the_prompt() -> None:
    """Audience, example queries, and distractors appear only when provided."""
    bare = _messages()
    assert "The people asking" not in bare
    assert "real example" not in bare
    assert "other excerpt" not in bare

    steered = _messages(
        audience="Support engineers triaging incidents",
        example_queries=["why does upload fail?", "retry limits?"],
        distractor_texts=["Unrelated excerpt about billing."],
    )
    assert "Support engineers triaging incidents" in steered
    assert "- why does upload fail?" in steered
    assert "answerable ONLY from the context" in steered
    assert "Unrelated excerpt about billing." in steered


def test_paraphrased_type_forbids_source_wording() -> None:
    """The paraphrased instruction differs from the single-fact one."""
    fact = _messages(question_type=EvalQuestionType.SINGLE_FACT)
    paraphrased = _messages(question_type=EvalQuestionType.PARAPHRASED)
    assert "WITHOUT reusing its wording" in paraphrased
    assert "WITHOUT reusing its wording" not in fact


def test_critique_prompt_lists_candidates_in_order() -> None:
    """The critique call enumerates candidates and demands a JSON array."""
    content = build_critique_messages(
        context_text="ctx",
        candidates=[
            CandidateQuestion(question="Q1?", answer="A1", quote="q"),
            CandidateQuestion(question="Q2?", answer="A2", quote="q"),
        ],
    )[1]["content"]
    assert "1. question: Q1?" in content
    assert "2. question: Q2?" in content
    assert '"groundedness": 1-5' in content
