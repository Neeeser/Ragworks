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

import base64
import binascii
import logging
from collections.abc import Sequence
from typing import Any
from uuid import UUID, uuid4

from sqlmodel import Session

from app.chat.messages import UserMessage
from app.db import models
from app.pipelines.image_assets import load_inline_media, read_image_dimensions
from app.pipelines.payloads import MediaAsset, image_asset_from_metadata
from app.providers.chat.content import (
    IMAGE_EXTENSION_BY_MEDIA_TYPE,
    SUPPORTED_IMAGE_MEDIA_TYPES,
    ContentPart,
    user_content,
)
from app.providers.registry import ProviderResolver
from app.schemas.chat import ChatImageAttachment
from app.schemas.enums import ProviderKind
from app.schemas.media import InlineMedia
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)

#: Ceiling on images forwarded per chat turn, across every tool call in
#: it. A wide top_k of image matches — or several parallel retrieval
#: calls — would otherwise inline megabytes per turn; the leading matches
#: are the ones the answer will cite.
MAX_IMAGES_PER_TURN = 4


def image_attachment_message(
    *,
    user: models.User,
    session: Session,
    session_model: models.ChatSession,
    response_payload: Any,
    limit: int = MAX_IMAGES_PER_TURN,
) -> UserMessage | None:
    """Return the follow-up message carrying a tool result's images, or None.

    `limit` is the turn's remaining image budget — the caller shrinks it
    per tool call so parallel calls share one ceiling.
    """
    if limit <= 0:
        return None
    assets = _image_assets(response_payload, limit)
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


def _image_assets(response_payload: Any, limit: int) -> list[MediaAsset]:
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
        if not isinstance(metadata, dict):
            continue
        asset = image_asset_from_metadata(metadata)
        if asset is None:
            continue
        if asset.path in seen:
            continue
        seen.add(asset.path)
        assets.append(asset)
        if len(assets) >= limit:
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
    # A catalog failure must not fail the chat turn; the tool JSON's
    # placeholder text already carries the match.
    except Exception:
        logger.warning("Chat model modalities unavailable; sending no images.")
        return False
    return "image" in modalities


def _load_images(assets: list[MediaAsset]) -> list[InlineMedia]:
    """Read asset bytes; an unreadable asset is skipped, never fatal."""
    storage = FileStorage()
    images: list[InlineMedia] = []
    for asset in assets:
        try:
            images.append(
                load_inline_media(storage, media_type=asset.media_type, path=asset.path)
            )
        except (OSError, ValueError, InvalidInputError):
            logger.warning("Image asset unreadable or over the size limit; skipping.")
            continue
    return images


def store_chat_attachments(
    session_id: UUID, attachments: Sequence[ChatImageAttachment]
) -> list[dict[str, Any]]:
    """Persist the send bar's attached images and return their asset dumps.

    Bytes land under `chat/{session_id}/` so a session's assets purge as
    one tree when it is deleted. Validation is the upload contract: a
    supported image media type and the configured image size cap — both
    reported as input errors, since the user picked the file.
    """
    limit_mb = get_app_config().uploads.max_image_upload_size_mb
    storage = FileStorage()
    stored: list[dict[str, Any]] = []
    for attachment in attachments:
        media_type = attachment.media_type.lower()
        if media_type not in SUPPORTED_IMAGE_MEDIA_TYPES:
            raise InvalidInputError(
                f"'{attachment.media_type}' is not a supported image type for chat."
            )
        try:
            data = base64.b64decode(attachment.data, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise InvalidInputError("Attached image data is not valid base64.") from exc
        if len(data) > limit_mb * 1024 * 1024:
            raise InvalidInputError(
                f"Attached image exceeds the configured {limit_mb}MB image limit."
            )
        width, height = read_image_dimensions(data)
        if width is None or height is None:
            raise InvalidInputError("Attached data is not a decodable image.")
        path = f"chat/{session_id}/{uuid4().hex}{IMAGE_EXTENSION_BY_MEDIA_TYPE[media_type]}"
        storage.write_bytes(data, path)
        stored.append(
            MediaAsset(
                media_type=media_type,
                path=path,
                byte_size=len(data),
                width=width,
                height=height,
            ).model_dump()
        )
    return stored


def strip_unreadable_image_parts(
    messages: list[dict[str, Any]],
    *,
    user: models.User,
    session: Session,
    session_model: models.ChatSession,
) -> list[dict[str, Any]]:
    """Reduce image-bearing user content to its text for a non-vision model.

    Attachments replay from history, and the session's model can change
    between turns — a text-only model handed image parts is a provider 400
    on a conversation that used to work. The text parts (and the message's
    own words) survive; only the bytes are withheld.
    """
    if not any(_has_image_parts(message) for message in messages):
        return messages
    if _model_reads_images(user, session, session_model):
        return messages
    return [
        {**message, "content": _text_of_parts(message["content"])}
        if _has_image_parts(message)
        else message
        for message in messages
    ]


def _has_image_parts(message: dict[str, Any]) -> bool:
    content = message.get("content")
    return isinstance(content, list) and any(
        isinstance(part, dict) and part.get("type") == "image_url" for part in content
    )


def _text_of_parts(parts: list[dict[str, Any]]) -> str:
    text = "\n".join(
        str(part.get("text", ""))
        for part in parts
        if isinstance(part, dict) and part.get("type") == "text"
    ).strip()
    # An image-only message must not strip to empty content — several
    # providers 400 on an empty history entry.
    return text or "[image attached]"


def copy_attachments_to_session(
    attachments: list[dict[str, Any]] | None, target_session_id: UUID
) -> list[dict[str, Any]] | None:
    """Duplicate a message's attachment bytes into another session's directory.

    Attachment paths encode the owning session (`chat/{session_id}/`) — the
    asset route's authorization scope and the deletion purge's boundary — so
    a branched session gets its own copies rather than paths the source
    session's deletion would break. An unreadable source asset is skipped;
    the copied message keeps its text.
    """
    if not attachments:
        return None
    storage = FileStorage()
    copied: list[dict[str, Any]] = []
    for raw in attachments:
        try:
            asset = MediaAsset.model_validate(raw)
            data = storage.read_bytes(asset.path)
        except (ValueError, OSError):
            continue
        extension = IMAGE_EXTENSION_BY_MEDIA_TYPE.get(asset.media_type, ".bin")
        path = f"chat/{target_session_id}/{uuid4().hex}{extension}"
        storage.write_bytes(data, path)
        copied.append(asset.model_copy(update={"path": path}).model_dump())
    return copied or None


def delete_attachment_files(attachment_lists: Sequence[list[dict[str, Any]]]) -> None:
    """Remove the stored bytes behind pruned messages' attachment records.

    An edit prunes the rows that reference these files; without this the
    bytes sit unaddressable until the whole session is deleted. Only
    session-owned paths are touched — a corrupt record must never reach
    into collection storage.
    """
    storage = FileStorage()
    for records in attachment_lists:
        for raw in records:
            path = raw.get("path")
            if isinstance(path, str) and path.startswith("chat/"):
                storage.delete_path(path)


def purge_session_assets(session_id: UUID) -> None:
    """Remove every image stored for a chat session's messages.

    The one deletion boundary for session-owned bytes: any caller that
    deletes a chat session calls this, so the purge cannot be missed by a
    second deletion path later.
    """
    FileStorage().delete_tree(f"chat/{session_id}")


def user_content_from_disk(
    content: str, attachments: list[dict[str, Any]] | None
) -> str | list[ContentPart]:
    """Rebuild a user message's content parts from its stored attachments.

    Attached images replay on every later turn, the way providers expect an
    image the conversation references to stay in history. An asset that no
    longer loads (deleted storage, over a lowered size cap) degrades that
    message to its text rather than failing the whole request build; the
    model-capability strip at the request boundary handles a session whose
    model no longer reads images.
    """
    if not attachments:
        return content
    storage = FileStorage()
    images: list[InlineMedia] = []
    for raw in attachments:
        try:
            asset = MediaAsset.model_validate(raw)
            images.append(
                load_inline_media(storage, media_type=asset.media_type, path=asset.path)
            )
        except (ValueError, OSError, InvalidInputError):
            continue
    if not images:
        return content
    return user_content(content, tuple(images))
