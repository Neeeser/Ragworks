"""Inferring what a model is from a flat OpenAI-compatible listing.

`GET /v1/models` publishes an id and nothing else — no modality, no context
length, no parameter list. So a kind has to be inferred from the id, and the
inference is deliberately lopsided: the *embedding* and *not-a-chat-model*
markers are matched explicitly, and everything unmatched falls into chat.

That asymmetry is the point. A marker list that gates what a user may select
would hide every model OpenAI ships after this file was written; falling
through to chat means a new model appears in the picker on the day it is
released, and the worst case is a speech model listed beside chat models rather
than a chat model that cannot be selected at all.

The custom provider reuses the same two predicates to *order* its listing
rather than filter it — for a server nobody has integrated, even a wrong guess
must not remove a model the server actually serves.
"""

from __future__ import annotations

from uuid import UUID

from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import CatalogModel

#: Substring that marks an embedding model. OpenAI has named every one
#: `text-embedding-*`; matching the bare word also catches a future family that
#: keeps the word without the prefix.
EMBEDDING_MARKER = "embedding"

#: Substrings marking models that take text in but do not hold a conversation.
#: Listing one in a chat picker is harmless but noisy, and every entry here is
#: a family that has never been a chat model.
NON_CHAT_MARKERS: tuple[str, ...] = (
    EMBEDDING_MARKER,
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "transcribe",
    "image",
    "audio",
    "realtime",
    "sora",
)


def is_embedding_model(model_id: str) -> bool:
    """True when the id names an embedding model."""
    return EMBEDDING_MARKER in model_id.casefold()


def is_chat_model(model_id: str) -> bool:
    """True unless the id names a family that has never served chat."""
    normalized = model_id.casefold()
    return not any(marker in normalized for marker in NON_CHAT_MARKERS)


def classify_openai_models(
    model_ids: list[str],
    *,
    kind: ProviderKind,
    connection_id: UUID,
    connection_label: str,
    provider_type: ProviderType,
    chat_parameters: list[str],
) -> list[CatalogModel]:
    """Return the connection's models of one kind, qualified by the connection."""
    if kind is ProviderKind.EMBEDDING:
        selected = [model_id for model_id in model_ids if is_embedding_model(model_id)]
        parameters: list[str] = []
        output_modalities = ["embedding"]
    else:
        selected = [model_id for model_id in model_ids if is_chat_model(model_id)]
        parameters = chat_parameters
        output_modalities = ["text"]
    return [
        CatalogModel(
            connection_id=connection_id,
            connection_label=connection_label,
            provider_type=provider_type,
            id=model_id,
            name=model_id,
            input_modalities=["text"],
            output_modalities=output_modalities,
            supported_parameters=parameters,
        )
        for model_id in sorted(selected)
    ]
