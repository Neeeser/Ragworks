"""Prompt and response-schema builders for synthetic generation and critique.

Plain functions returning chat messages plus the `response_format` JSON
schemas the calls are made with. The prompts encode the research-backed
guardrails: a verbatim quote requirement (mechanical groundedness),
distractor conditioning (questions only the target context answers),
type-specific instructions (paraphrased questions avoid the source's
wording), and optional audience/example steering toward realistic usage.
Output shape is enforced by the provider's structured-outputs feature, never
by prompt formatting alone — the in-prompt shape line is only the safety net
for providers that ignore `response_format`.

An image context is prompted from the page itself: the instructions are
written for a visual source, nothing is quoted (there is no text to copy),
and the page rides on the message as an inline content part. The page *is*
the per-call payload, the same relationship an image-carrying pipeline shell
declares with `carries_media`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.evals.generation.candidates import CandidateQuestion
from app.evals.generation.contexts import GenerationContext, ImageContext
from app.providers.chat.content import ContentPart, user_content
from app.schemas.enums import EvalQuestionType

GENERATION_SYSTEM_PROMPT = (
    "You write retrieval evaluation questions for a document collection. Every"
    " question must be answerable from the given context excerpt alone, make"
    " sense to someone who has never seen the excerpt, and read like something"
    " a real user would type."
)

IMAGE_GENERATION_SYSTEM_PROMPT = (
    "You write retrieval evaluation questions for a collection of document"
    " pages stored as images. Every question must be answerable from the page"
    " shown alone, make sense to someone who has never seen the page, and read"
    " like something a real user would type."
)

CRITIQUE_SYSTEM_PROMPT = "You grade retrieval evaluation questions against their source excerpt."

IMAGE_CRITIQUE_SYSTEM_PROMPT = (
    "You grade retrieval evaluation questions against the document page they were written from."
)

_SCORE_PROPERTY = {"type": "integer", "minimum": 1, "maximum": 5}


def _candidates_format(properties: list[str]) -> dict[str, object]:
    """The generation response schema over one set of candidate fields."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "eval_question_candidates",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "candidates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {name: {"type": "string"} for name in properties},
                            "required": list(properties),
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["candidates"],
                "additionalProperties": False,
            },
        },
    }


GENERATION_RESPONSE_FORMAT: dict[str, object] = _candidates_format(["question", "answer", "quote"])

#: An image candidate carries no quote: there is nothing to copy verbatim
#: from a page image, and asking for one invites invented OCR text that the
#: quote gate could not check anyway.
IMAGE_GENERATION_RESPONSE_FORMAT: dict[str, object] = _candidates_format(["question", "answer"])

CRITIQUE_RESPONSE_FORMAT: dict[str, object] = {
    "type": "json_schema",
    "json_schema": {
        "name": "eval_question_scores",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "scores": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "groundedness": _SCORE_PROPERTY,
                            "standalone": _SCORE_PROPERTY,
                            "realism": _SCORE_PROPERTY,
                        },
                        "required": ["groundedness", "standalone", "realism"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["scores"],
            "additionalProperties": False,
        },
    },
}

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

_IMAGE_TYPE_INSTRUCTIONS: dict[EvalQuestionType, str] = {
    EvalQuestionType.SINGLE_FACT: (
        "Each question asks for one specific fact shown on the page — a figure"
        " in a table, a labelled value on a chart, a line of the printed text —"
        " and has a short, unambiguous answer."
    ),
    EvalQuestionType.PARAPHRASED: (
        "Each question asks about the page WITHOUT reusing the wording printed"
        " on it: rephrase every distinctive term with synonyms or plainer"
        " language, as a user who half-remembers the page would. The answer"
        " must still be shown on the page."
    ),
    EvalQuestionType.MULTI_DETAIL: (
        "Each question requires combining two or more distinct details from"
        " different parts of the page — a heading and a table cell, two series"
        " on a chart — into one answer."
    ),
}


@dataclass(frozen=True)
class PromptMessage:
    """One chat message on a generation or critique call.

    Content stays typed until the request is built, so a text-only call still
    serializes to a plain string and existing datasets keep the exact request
    shape they have today.
    """

    role: Literal["system", "user"]
    content: str | list[ContentPart]


def generation_response_format(context: GenerationContext) -> dict[str, object]:
    """The response schema a generation call over this context is made with."""
    if isinstance(context, ImageContext):
        return IMAGE_GENERATION_RESPONSE_FORMAT
    return GENERATION_RESPONSE_FORMAT


def build_generation_messages(
    *,
    context: GenerationContext,
    question_type: EvalQuestionType,
    candidates_per_context: int,
    audience: str | None,
    example_queries: list[str],
    distractor_texts: list[str],
) -> list[PromptMessage]:
    """Messages for one generation call over one planned context."""
    if isinstance(context, ImageContext):
        return _image_generation_messages(
            context=context,
            question_type=question_type,
            candidates_per_context=candidates_per_context,
            audience=audience,
            example_queries=example_queries,
        )
    parts: list[str] = [
        f"Write {candidates_per_context} candidate questions about the context below.",
        _TYPE_INSTRUCTIONS[question_type],
        'For each candidate, include a "quote": a verbatim excerpt copied'
        " exactly from the context that contains the answer. Do not alter the"
        " quote in any way.",
        "If the context cannot support a question of this kind, return fewer"
        " candidates, or an empty array.",
        *_steering_parts(audience, example_queries),
    ]
    if distractor_texts:
        distractors = "\n\n".join(
            f"[other excerpt {index + 1}]\n{text}" for index, text in enumerate(distractor_texts)
        )
        parts.append(
            "The collection also contains other content, like the excerpts"
            " below. Every question must be answerable ONLY from the context,"
            f" not from these:\n\n{distractors}"
        )
    parts.append(f"CONTEXT:\n{context.text}")
    parts.append(
        'Reply with a JSON object: {"candidates": [{"question": "...",'
        ' "answer": "...", "quote": "..."}]}'
    )
    return [
        PromptMessage(role="system", content=GENERATION_SYSTEM_PROMPT),
        PromptMessage(role="user", content="\n\n".join(parts)),
    ]


def build_critique_messages(
    *,
    context: GenerationContext,
    candidates: list[CandidateQuestion],
) -> list[PromptMessage]:
    """Messages for one batched critique call over a context's candidates."""
    listed = "\n".join(
        f"{index + 1}. question: {candidate.question}\n   answer: {candidate.answer}"
        for index, candidate in enumerate(candidates)
    )
    source = "page" if isinstance(context, ImageContext) else "excerpt"
    criteria = (
        "Score each candidate question from 1 (bad) to 5 (excellent) on three"
        " criteria:\n"
        f"- groundedness: the answer is fully and unambiguously stated in the {source}.\n"
        "- standalone: the question makes sense on its own, with no phrasing"
        f' like "according to the {source}" and no references to the {source}.\n'
        "- realism: a real user of this collection would plausibly ask it.\n"
    )
    tail = (
        f"\nCANDIDATES:\n{listed}\n\n"
        "Reply with a JSON object, one entry per candidate in order:"
        ' {"scores": [{"groundedness": 1-5, "standalone": 1-5, "realism": 1-5}]}'
    )
    if isinstance(context, ImageContext):
        body = f"{criteria}\nThe document page being scored is attached.\n{tail}"
        return [
            PromptMessage(role="system", content=IMAGE_CRITIQUE_SYSTEM_PROMPT),
            PromptMessage(role="user", content=user_content(body, (context.image,))),
        ]
    return [
        PromptMessage(role="system", content=CRITIQUE_SYSTEM_PROMPT),
        PromptMessage(role="user", content=f"{criteria}\nEXCERPT:\n{context.text}\n{tail}"),
    ]


def _image_generation_messages(
    *,
    context: ImageContext,
    question_type: EvalQuestionType,
    candidates_per_context: int,
    audience: str | None,
    example_queries: list[str],
) -> list[PromptMessage]:
    """Messages for one generation call over a single page image.

    No distractor conditioning: contrasting against other pages would attach
    them all to every call, which multiplies the image payload for steering
    the text path gets from a 600-character snippet.
    """
    parts: list[str] = [
        f"Write {candidates_per_context} candidate questions about the document"
        " page attached to this message.",
        _IMAGE_TYPE_INSTRUCTIONS[question_type],
        'Do not refer to "the page", "the image", or "the document" in the'
        " questions — a user searching the collection has not seen it yet.",
        "If the page cannot support a question of this kind — it is blank, a"
        " cover, or unreadable — return fewer candidates, or an empty array.",
        *_steering_parts(audience, example_queries),
        'Reply with a JSON object: {"candidates": [{"question": "...", "answer": "..."}]}',
    ]
    return [
        PromptMessage(role="system", content=IMAGE_GENERATION_SYSTEM_PROMPT),
        PromptMessage(
            role="user", content=user_content("\n\n".join(parts), (context.image,))
        ),
    ]


def _steering_parts(audience: str | None, example_queries: list[str]) -> list[str]:
    """The optional audience and example-query steering, when supplied."""
    parts: list[str] = []
    if audience:
        parts.append(f"The people asking these questions: {audience}")
    if example_queries:
        examples = "\n".join(f"- {query}" for query in example_queries)
        parts.append(
            f"Match the style, tone, and specificity of these real example queries:\n{examples}"
        )
    return parts
