"""Attach retrieved image assets to the model turn that follows a tool result.

A retrieval tool's result reaches the model as JSON, where an image match
is its placeholder text plus metadata. When the session's model publishes
image input, the images themselves follow as a user message of content
parts — a user message because image parts in tool-role messages are not
part of the Chat Completions contract most providers implement, while
every vision model accepts them on a user turn.

A model whose catalog does not state image input gets nothing extra: the
placeholder text is already in the tool JSON, and sending bytes a model
cannot read is a provider 400 in the middle of a chat turn. The message
is transport-only — it is never persisted, so the transcript shows the
tool result and the images ride along only on the turn they inform.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlmodel import Session

from app.chat.messages import UserMessage
from app.db import models
from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY, MediaAsset
from app.providers.chat.content import user_content
from app.providers.registry import ProviderResolver
from app.schemas.enums import ProviderKind
from app.schemas.media import InlineMedia
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)

#: Ceiling on images forwarded per tool result. A wide top_k of image
#: matches would otherwise inline megabytes per turn; the leading matches
#: are the ones the answer will cite.
MAX_IMAGES_PER_TOOL_RESULT = 4


def image_attachment_message(
    *,
    user: models.User,
    session: Session,
    session_model: models.ChatSession,
    response_payload: Any,
) -> UserMessage | None:
    """Return the follow-up message carrying a tool result's images, or None."""
    assets = _image_assets(response_payload)
    if not assets:
        return None
    if not _model_reads_images(user, session, session_model):
        return None
    images = _load_images(assets)
    if not images:
        return None
    return UserMessage(
        content=user_content(
            "Images referenced by the tool result above, in match order:", tuple(images)
        )
    )


def _image_assets(response_payload: Any) -> list[MediaAsset]:
    """Collect the distinct image assets a tool response's chunks reference."""
    if not isinstance(response_payload, dict):
        return []
    chunks = response_payload.get("chunks")
    if not isinstance(chunks, list):
        return []
    assets: list[MediaAsset] = []
    seen: set[str] = set()
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        metadata = chunk.get("metadata")
        raw = metadata.get(IMAGE_ASSET_METADATA_KEY) if isinstance(metadata, dict) else None
        if not isinstance(raw, dict):
            continue
        try:
            asset = MediaAsset.model_validate(raw)
        except ValueError:
            continue
        if asset.path in seen:
            continue
        seen.add(asset.path)
        assets.append(asset)
        if len(assets) >= MAX_IMAGES_PER_TOOL_RESULT:
            break
    return assets


def _model_reads_images(
    user: models.User, session: Session, session_model: models.ChatSession
) -> bool:
    """True when the session model's catalog publishes image input.

    Unknown stays False here, unlike the pipeline editor's silence on
    unknown: validation not warning costs nothing, but transmitting image
    bytes to a model that cannot read them fails the whole chat turn.
    """
    connection_id = session_model.provider_connection_id
    model_name = session_model.chat_model
    if connection_id is None or not model_name:
        return False
    try:
        modalities = ProviderResolver(user, session).input_modalities(
            connection_id, model_name, ProviderKind.CHAT
        )
    except Exception:  # noqa: BLE001 -- a catalog failure must not fail the turn
        logger.warning("Chat model modalities unavailable; sending no images.")
        return False
    return "image" in modalities


def _load_images(assets: list[MediaAsset]) -> list[InlineMedia]:
    """Read asset bytes; an unreadable asset is skipped, never fatal."""
    storage = FileStorage()
    images: list[InlineMedia] = []
    for asset in assets:
        try:
            data = storage.read_bytes(asset.path)
        except (OSError, ValueError):
            logger.warning("Image asset unreadable; skipping: %s", asset.path)
            continue
        images.append(InlineMedia(media_type=asset.media_type, data=data))
    return images
