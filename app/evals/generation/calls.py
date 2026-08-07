"""One context window's model calls: generate, filter, critique.

`generator.py` owns the loop, its progress commits, and persistence; this
module owns what happens for a single planned context. The two mechanical
gates run before the critique call because they are free and catch most
ungrounded or repeated output.

The verbatim-quote gate is text-against-text, so an image context skips it: a
page image carries no quotable source, and the critique scores are the whole
acceptance decision there.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.evals.generation.candidates import (
    CandidateQuestion,
    CritiqueScores,
    is_duplicate_question,
    parse_candidates,
    parse_critiques,
    quote_matches,
)
from app.evals.generation.contexts import ContextPlan, GenerationContext, TextContext
from app.evals.generation.prompts import (
    CRITIQUE_RESPONSE_FORMAT,
    PromptMessage,
    build_critique_messages,
    build_generation_messages,
    generation_response_format,
)
from app.providers.chat.base import ChatProvider, ChatRequest
from app.providers.chat.content import dump_content
from app.schemas.evals_generation import EvalDatasetGenerateRequest

CANDIDATES_PER_CONTEXT = 3
CRITIQUE_MINIMUM = 4
GENERATION_TEMPERATURE = 0.7
CRITIQUE_TEMPERATURE = 0.0


@dataclass(frozen=True)
class ModalityChat:
    """The provider and model one modality's calls are made with."""

    chat: ChatProvider
    model: str


@dataclass(frozen=True)
class ContextBatch:
    """One context's surviving candidates with their scores."""

    generated: int
    kept: list[tuple[CandidateQuestion, CritiqueScores]]


def generate_for_context(
    caller: ModalityChat,
    config: EvalDatasetGenerateRequest,
    *,
    context: GenerationContext,
    plan: ContextPlan,
    distractor_snippets: list[str],
    accepted_texts: list[str],
) -> ContextBatch:
    """One generation call plus (when needed) one critique call for a context."""
    reply = chat_text(
        caller,
        build_generation_messages(
            context=context,
            question_type=plan.question_type,
            candidates_per_context=CANDIDATES_PER_CONTEXT,
            audience=config.audience,
            example_queries=config.example_queries,
            distractor_texts=distractor_snippets,
        ),
        temperature=GENERATION_TEMPERATURE,
        response_format=generation_response_format(context),
    )
    quotable = isinstance(context, TextContext)
    candidates = parse_candidates(reply, require_quote=quotable)
    generated = len(candidates)
    candidates = [
        candidate
        for candidate in candidates
        if _grounded(candidate, context)
        and not is_duplicate_question(candidate.question, accepted_texts)
    ]
    if not candidates:
        return ContextBatch(generated=generated, kept=[])
    critique_reply = chat_text(
        caller,
        build_critique_messages(context=context, candidates=candidates),
        temperature=CRITIQUE_TEMPERATURE,
        response_format=CRITIQUE_RESPONSE_FORMAT,
    )
    scores = parse_critiques(critique_reply, len(candidates))
    if scores is None:
        return ContextBatch(generated=generated, kept=[])
    kept: list[tuple[CandidateQuestion, CritiqueScores]] = []
    batch_texts: list[str] = []
    for candidate, score in zip(candidates, scores, strict=True):
        if not score.passes(CRITIQUE_MINIMUM):
            continue
        if is_duplicate_question(candidate.question, batch_texts):
            continue
        kept.append((candidate, score))
        batch_texts.append(candidate.question)
    return ContextBatch(generated=generated, kept=kept)


def chat_text(
    caller: ModalityChat,
    messages: list[PromptMessage],
    *,
    temperature: float,
    response_format: dict[str, object],
) -> str:
    """One non-streaming structured-output chat call, reduced to its text.

    Content is rendered through `dump_content`, the same boundary the LLM
    engine's requests pass, so a text-only message serializes to a plain
    string and a message carrying a page image serializes to typed content
    parts.

    The output shape is enforced by the provider's structured-outputs feature
    (`response_format` with a strict JSON schema) — the wizard only offers
    models that advertise support, and the tolerant parsers remain as the
    safety net for providers that ignore the parameter.
    """
    request = ChatRequest(
        messages=[
            {"role": message.role, "content": dump_content(message.content)}
            for message in messages
        ],
        tools=None,
        model=caller.model,
        parameters={"temperature": temperature, "response_format": response_format},
    )
    parsed = caller.chat.parse_chat_response(caller.chat.chat(request))
    content = parsed.message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return ""


def _grounded(candidate: CandidateQuestion, context: GenerationContext) -> bool:
    """True when the candidate's quote is (near-)verbatim in a text context.

    An image context has no quotable source, so nothing mechanical is checked
    and the critique scores decide acceptance on their own.
    """
    if not isinstance(context, TextContext):
        return True
    return quote_matches(candidate.quote, context.text)
