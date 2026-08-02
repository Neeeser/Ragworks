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

from typing import Any

from pydantic import TypeAdapter
from sqlmodel import Session

from app.db import models
from app.pipelines.llm.config import LlmNodeConfig, OutputFieldSpec
from app.pipelines.llm.engine import LlmEngine
from app.pipelines.llm.output_schema import per_item_schema, validate_fields
from app.prompting import catalog_for, referenced_variables, render_template
from app.providers.chat.base import ChatRequest
from app.providers.registry import ProviderResolver
from app.schemas.enums import PromptContext
from app.schemas.prompts import (
    PromptRenderRead,
    PromptRenderRequest,
    PromptTestRead,
    PromptTestRequest,
)
from app.services.errors import InvalidInputError

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


def run_test(
    session: Session,
    user: models.User,
    payload: PromptTestRequest,
) -> PromptTestRead:
    """Execute a prompt against a live model from the test bench."""
    preview = render_preview(
        PromptRenderRequest(
            body=payload.body,
            system_body=payload.system_body,
            context=payload.context,
            values=payload.values,
        )
    )
    providers = ProviderResolver(user, session)
    if payload.context in _NODE_CONTEXTS and payload.output_fields:
        structured = _run_structured(providers, payload, preview)
        return PromptTestRead(
            rendered=preview.rendered,
            rendered_system=preview.rendered_system,
            structured_output=structured,
        )
    text = _run_completion(providers, payload, preview)
    return PromptTestRead(
        rendered=preview.rendered,
        rendered_system=preview.rendered_system,
        response_text=text,
    )


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


def _run_completion(
    providers: ProviderResolver,
    payload: PromptTestRequest,
    preview: PromptRenderRead,
) -> str:
    """One plain completion for chat-context prompts."""
    provider = providers.chat(payload.connection_id)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": preview.rendered},
        {
            "role": "user",
            "content": "Introduce yourself briefly and state what you can help with.",
        },
    ]
    request = ChatRequest(
        messages=messages,
        tools=None,
        model=payload.model_name,
        parameters=None,
    )
    parsed = provider.parse_chat_response(provider.chat(request))
    content = parsed.message.get("content")
    return content if isinstance(content, str) else ""
