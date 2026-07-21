"""Prompt builders for synthetic question generation and critique.

Plain functions returning chat messages. The prompts encode the
research-backed guardrails: a verbatim quote requirement (mechanical
groundedness), distractor conditioning (questions only the target context
answers), type-specific instructions (paraphrased questions avoid the
source's wording), and optional audience/example steering toward realistic
usage. Both calls demand a bare JSON array so small models have the simplest
possible output contract.
"""

from __future__ import annotations

from app.evals.generation.candidates import CandidateQuestion
from app.schemas.enums import EvalQuestionType

GENERATION_SYSTEM_PROMPT = (
    "You write retrieval evaluation questions for a document collection. Every"
    " question must be answerable from the given context excerpt alone, make"
    " sense to someone who has never seen the excerpt, and read like something"
    " a real user would type. Reply with a JSON array only — no prose, no"
    " markdown fences."
)

CRITIQUE_SYSTEM_PROMPT = (
    "You grade retrieval evaluation questions against their source excerpt."
    " Reply with a JSON array only — no prose, no markdown fences."
)

_TYPE_INSTRUCTIONS: dict[EvalQuestionType, str] = {
    EvalQuestionType.SINGLE_FACT: (
        "Each question asks for one specific fact stated in the context and has"
        " a short, unambiguous answer."
    ),
    EvalQuestionType.PARAPHRASED: (
        "Each question asks about the context WITHOUT reusing its wording:"
        " rephrase every distinctive term with synonyms or plainer language, as"
        " a user who half-remembers the topic would. The answer must still be"
        " stated in the context."
    ),
    EvalQuestionType.MULTI_DETAIL: (
        "Each question requires combining two or more distinct details from"
        " different parts of the context into one answer."
    ),
}


def build_generation_messages(
    *,
    context_text: str,
    question_type: EvalQuestionType,
    candidates_per_context: int,
    audience: str | None,
    example_queries: list[str],
    distractor_texts: list[str],
) -> list[dict[str, str]]:
    """Messages for one generation call over one context window."""
    parts: list[str] = [
        f"Write {candidates_per_context} candidate questions about the context"
        " below.",
        _TYPE_INSTRUCTIONS[question_type],
        'For each candidate, include a "quote": a verbatim excerpt copied'
        " exactly from the context that contains the answer. Do not alter the"
        " quote in any way.",
        "If the context cannot support a question of this kind, return fewer"
        " candidates, or an empty array.",
    ]
    if audience:
        parts.append(f"The people asking these questions: {audience}")
    if example_queries:
        examples = "\n".join(f"- {query}" for query in example_queries)
        parts.append(
            "Match the style, tone, and specificity of these real example"
            f" queries:\n{examples}"
        )
    if distractor_texts:
        distractors = "\n\n".join(
            f"[other excerpt {index + 1}]\n{text}"
            for index, text in enumerate(distractor_texts)
        )
        parts.append(
            "The collection also contains other content, like the excerpts"
            " below. Every question must be answerable ONLY from the context,"
            f" not from these:\n\n{distractors}"
        )
    parts.append(f"CONTEXT:\n{context_text}")
    parts.append(
        'Reply with a JSON array of objects: [{"question": "...", "answer":'
        ' "...", "quote": "..."}]'
    )
    return [
        {"role": "system", "content": GENERATION_SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def build_critique_messages(
    *,
    context_text: str,
    candidates: list[CandidateQuestion],
) -> list[dict[str, str]]:
    """Messages for one batched critique call over a context's candidates."""
    listed = "\n".join(
        f"{index + 1}. question: {candidate.question}\n   answer: {candidate.answer}"
        for index, candidate in enumerate(candidates)
    )
    body = (
        "Score each candidate question from 1 (bad) to 5 (excellent) on three"
        " criteria:\n"
        "- groundedness: the answer is fully and unambiguously stated in the"
        " excerpt.\n"
        "- standalone: the question makes sense on its own, with no phrasing"
        ' like "according to the text" and no references to the excerpt.\n'
        "- realism: a real user of this collection would plausibly ask it.\n\n"
        f"EXCERPT:\n{context_text}\n\n"
        f"CANDIDATES:\n{listed}\n\n"
        "Reply with a JSON array, one object per candidate in order:"
        ' [{"groundedness": 1-5, "standalone": 1-5, "realism": 1-5}]'
    )
    return [
        {"role": "system", "content": CRITIQUE_SYSTEM_PROMPT},
        {"role": "user", "content": body},
    ]
