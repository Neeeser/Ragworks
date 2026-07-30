"""Model listing for OpenAI-compatible endpoints.

`GET /v1/models` is the only discovery surface the OpenAI-compatible family
agrees on, and it publishes an id and almost nothing else — no context length,
no modality, no supported parameters. So this returns the ids as-is and leaves
every judgement about what a model *is* to the adapter that knows the provider;
inventing metadata here would put a guess behind a typed field that reads as
fact everywhere downstream.
"""

from __future__ import annotations

from app.clients.openai_compat.transport import OpenAICompatTransport
from app.schemas.chat_completions import ModelListResponse


def list_model_ids(transport: OpenAICompatTransport) -> list[str]:
    """Return the ids published by the endpoint, in the order it returned them."""
    response = transport.http.get("/models")
    response.raise_for_status()
    listing = ModelListResponse.model_validate(response.json())
    return [entry.id for entry in listing.data if entry.id]
