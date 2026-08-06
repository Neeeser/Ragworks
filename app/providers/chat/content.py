"""Multimodal message content parts, in the canonical Chat Completions shape.

A message's content is either a plain string or a list of typed parts. The
Chat Completions spelling (`{"type": "image_url", "image_url": {"url": ...}}`,
data URI for inline bytes) is the internal contract every caller builds and
every dialect reads, the same way `ChatRequest` is provider-neutral: the
OpenAI-compatible dialect passes parts straight through and the Anthropic
dialect translates them into its own image blocks.
"""

from __future__ import annotations

from typing import Any

from app.schemas.media import InlineMedia

#: Image media types every supported vision provider accepts. Anthropic
#: publishes exactly this set on its base64 image source, and it is the
#: same set the upload catalog offers, so a narrower per-provider list
#: would reject an image the app told the user it could ingest.
SUPPORTED_IMAGE_MEDIA_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/gif", "image/webp"}
)

#: File extension per supported media type, so stored assets are
#: recognizable on disk. Keyed by the same set as
#: `SUPPORTED_IMAGE_MEDIA_TYPES` — adding a format updates both together.
IMAGE_EXTENSION_BY_MEDIA_TYPE: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def text_part(text: str) -> dict[str, Any]:
    """Return one text content part."""
    return {"type": "text", "text": text}


def image_part(attachment: InlineMedia) -> dict[str, Any]:
    """Return one image content part carrying inline bytes."""
    return {"type": "image_url", "image_url": {"url": attachment.data_uri()}}


def user_content(text: str, images: tuple[InlineMedia, ...]) -> str | list[dict[str, Any]]:
    """Build a user message's content from text plus any attachments.

    Text leads: providers parse a trailing image against the instruction
    before it, and OpenRouter documents that order explicitly. With no
    attachments the content stays a plain string, so every existing
    text-only request keeps exactly the shape it has today.
    """
    if not images:
        return text
    parts: list[dict[str, Any]] = []
    if text:
        parts.append(text_part(text))
    parts.extend(image_part(image) for image in images)
    return parts


def split_data_uri(url: str) -> tuple[str, str] | None:
    """Split a base64 data URI into (media_type, base64 payload).

    Returns None for a plain http(s) URL — a dialect that cannot forward a
    remote reference has to know the difference rather than shipping the
    URL as if it were encoded bytes.
    """
    if not url.startswith("data:"):
        return None
    header, _, payload = url.partition(",")
    if not payload or not header.endswith(";base64"):
        return None
    media_type = header[len("data:") : -len(";base64")]
    return (media_type or "application/octet-stream", payload)
