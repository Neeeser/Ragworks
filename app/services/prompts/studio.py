"""The studio's render preview and live test bench.

Preview renders a draft template against the context's example values
(overlaid with any caller-supplied ones) and reports unknown variables
without failing — the editor shows findings while the user types. The
test bench executes the rendered prompt against a real model: node
contexts run through the same `LlmEngine` path the pipeline nodes use, so
structured output behaves exactly as in a run; chat contexts send a plain
completion.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from pydantic import TypeAdapter
from sqlmodel import Session

from app.db import models
from app.observability import get_logger
from app.pipelines.llm.config import LlmNodeConfig, OutputFieldSpec
from app.pipelines.llm.engine import LlmEngine
from app.pipelines.llm.output_schema import per_item_schema, validate_fields
from app.prompting import catalog_for, referenced_variables, render_template
from app.providers.chat.base import ChatProvider, ChatRequest
from app.providers.registry import ProviderResolver
from app.schemas.enums import PromptContext
from app.schemas.prompts import (
    PromptRenderRead,
    PromptRenderRequest,
    PromptTestEvent,
    PromptTestMessage,
    PromptTestRead,
    PromptTestRequest,
    PromptTestStartEvent,
    PromptTestStructuredEvent,
    PromptTestTokenEvent,
)
from app.services.errors import InvalidInputError

logger = get_logger(__name__)

#: The canned turn a chat-context test reacts to — chat prompts are system
#: prompts, so the bench needs a user message for the model to answer.
CHAT_TEST_USER_TURN = "Introduce yourself briefly and state what you can help with."

_OUTPUT_FIELDS = TypeAdapter(list[OutputFieldSpec])

_NODE_CONTEXTS = frozenset(
    {PromptContext.NODE_TRANSFORM, PromptContext.NODE_RERANK, PromptContext.NODE_GENERATE}
)


def example_values(context: PromptContext) -> dict[str, str]:
    """The catalog's example values, used as the preview's default context."""
    values: dict[str, str] = {}
    for variable in catalog_for(context).variables:
        values[variable.name] = variable.example or f"({variable.name})"
    return values


def render_preview(payload: PromptRenderRequest) -> PromptRenderRead:
    """Render a draft leniently and report its strict-validation findings."""
    catalog = catalog_for(payload.context)
    values = {**example_values(payload.context), **payload.values}
    unknown: set[str] = set()
    for template in (payload.body, payload.system_body or ""):
        unknown.update(catalog.unknown_variables(referenced_variables(template)))

    def _keep(name: str) -> str:
        return f"{{{{{name}}}}}"

    rendered = render_template(payload.body, values, on_missing=_keep)
    rendered_system = (
        render_template(payload.system_body, values, on_missing=_keep)
        if payload.system_body
        else None
    )
    return PromptRenderRead(
        rendered=rendered,
        rendered_system=rendered_system,
        unknown_variables=sorted(unknown),
        values=values,
    )


def stream_test(
    session: Session,
    user: models.User,
    payload: PromptTestRequest,
) -> Iterator[PromptTestEvent]:
    """Run a test, yielding what is known as soon as it is known.

    The payload is emitted before the model is called (so the bench can show
    exactly what it sent while the answer is still arriving), then either
    token deltas or — for a structured run, which the engine returns whole —
    one result event. `run_test` drains this same generator, so buffered and
    streaming runs can never diverge.
    """
    preview = render_preview(
        PromptRenderRequest(
            body=payload.body,
            system_body=payload.system_body,
            context=payload.context,
            values=payload.values,
        )
    )
    providers = ProviderResolver(user, session)
    messages = _test_messages(payload.context, preview)
    yield PromptTestStartEvent(
        rendered=preview.rendered,
        rendered_system=preview.rendered_system,
        messages=messages,
    )
    if payload.context in _NODE_CONTEXTS and payload.output_fields:
        yield PromptTestStructuredEvent(structured_output=_run_structured(providers, payload, preview))
        return
    for delta in _stream_completion(providers, payload, messages):
        yield PromptTestTokenEvent(content=delta)


def run_test(
    session: Session,
    user: models.User,
    payload: PromptTestRequest,
) -> PromptTestRead:
    """Execute a prompt against a live model, buffered into one result."""
    rendered = ""
    rendered_system: str | None = None
    messages: list[PromptTestMessage] = []
    structured: dict[str, object] | None = None
    tokens: list[str] = []
    for event in stream_test(session, user, payload):
        if isinstance(event, PromptTestStartEvent):
            rendered = event.rendered
            rendered_system = event.rendered_system
            messages = event.messages
        elif isinstance(event, PromptTestStructuredEvent):
            structured = event.structured_output
        else:
            tokens.append(event.content)
    return PromptTestRead(
        rendered=rendered,
        rendered_system=rendered_system,
        messages=messages,
        response_text="".join(tokens) if structured is None else None,
        structured_output=structured,
    )


def _test_messages(
    context: PromptContext, preview: PromptRenderRead
) -> list[PromptTestMessage]:
    """The exact message payload a test run sends.

    Chat-context prompts *are* system prompts, so the rendered body goes in
    the system slot with a canned user turn to react to; node-context
    prompts are the user message itself, under their own system template.
    """
    if context in _NODE_CONTEXTS:
        messages: list[PromptTestMessage] = []
        if preview.rendered_system:
            messages.append(PromptTestMessage(role="system", content=preview.rendered_system))
        messages.append(PromptTestMessage(role="user", content=preview.rendered))
        return messages
    return [
        PromptTestMessage(role="system", content=preview.rendered),
        PromptTestMessage(role="user", content=CHAT_TEST_USER_TURN),
    ]


def _run_structured(
    providers: ProviderResolver,
    payload: PromptTestRequest,
    preview: PromptRenderRead,
) -> dict[str, Any]:
    """One structured call through the real LLM engine path."""
    fields = _parse_output_fields(payload.output_fields)
    config = LlmNodeConfig(
        connection_id=payload.connection_id,
        model_name=payload.model_name,
        system_prompt=payload.system_body or "",
        prompt=payload.body,
        output_fields=fields,
    )
    engine = LlmEngine(providers, config, node_label="Test bench", strict=True)
    outcomes = engine.run_calls(
        [(preview.rendered_system or "", preview.rendered)],
        per_item_schema(fields),
        lambda raw: validate_fields(raw, fields),
    )
    values = outcomes[0].values
    return dict(values) if values is not None else {}


def _parse_output_fields(raw: list[dict[str, object]]) -> list[OutputFieldSpec]:
    try:
        return _OUTPUT_FIELDS.validate_python(raw)
    except ValueError as exc:
        raise InvalidInputError(f"Invalid output fields: {exc}") from exc


def _stream_completion(
    providers: ProviderResolver,
    payload: PromptTestRequest,
    messages: list[PromptTestMessage],
) -> Iterator[str]:
    """Content deltas for the already-built test payload.

    Streaming is what makes the bench feel live, but a provider that cannot
    stream must still answer: a failure opening the stream falls back to one
    buffered call yielding its whole content, so the caller sees the same
    event shape either way.
    """
    provider = providers.chat(payload.connection_id)
    request = ChatRequest(
        messages=[{"role": message.role, "content": message.content} for message in messages],
        tools=None,
        model=payload.model_name,
        parameters=None,
    )
    try:
        chunks = provider.chat_stream(request)
    except Exception:
        logger.warning("prompt.test.stream_unavailable", provider=provider.name)
        yield _buffered_content(provider, request)
        return
    for chunk in chunks:
        parsed = provider.parse_stream_chunk(chunk)
        if parsed is None:
            continue
        delta = parsed.delta_content
        if isinstance(delta, str) and delta:
            yield delta


def _buffered_content(provider: ChatProvider, request: ChatRequest) -> str:
    """The whole reply from one non-streaming call."""
    parsed = provider.parse_chat_response(provider.chat(request))
    content = parsed.message.get("content")
    return content if isinstance(content, str) else ""
