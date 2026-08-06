"""Multimodal message content parts, in the canonical Chat Completions shape.

A message's content is either a plain string or a list of typed parts. The
Chat Completions spelling (`{"type": "image_url", "image_url": {"url": ...}}`,
data URI for inline bytes) is the internal contract every caller builds and
every dialect reads, the same way `ChatRequest` is provider-neutral: the
OpenAI-compatible dialect passes parts straight through and the Anthropic
dialect translates them into its own image blocks.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

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


class TextPart(BaseModel):
    """One text content part."""

    type: Literal["text"] = "text"
    text: str


class ImageUrl(BaseModel):
    """An image part's URL payload — a data URI for inline bytes."""

    url: str


class ImageUrlPart(BaseModel):
    """One image content part carrying inline bytes."""

    type: Literal["image_url"] = "image_url"
    image_url: ImageUrl


ContentPart = Annotated[TextPart | ImageUrlPart, Field(discriminator="type")]


def text_part(text: str) -> TextPart:
    """Return one text content part."""
    return TextPart(text=text)


def image_part(attachment: InlineMedia) -> ImageUrlPart:
    """Return one image content part carrying inline bytes."""
    return ImageUrlPart(image_url=ImageUrl(url=attachment.data_uri()))


def user_content(text: str, images: tuple[InlineMedia, ...]) -> str | list[ContentPart]:
    """Build a user message's content from text plus any attachments.

    Text leads: providers parse a trailing image against the instruction
    before it, and OpenRouter documents that order explicitly. With no
    attachments the content stays a plain string, so every existing
    text-only request keeps exactly the shape it has today.
    """
    if not images:
        return text
    parts: list[ContentPart] = []
    if text:
        parts.append(text_part(text))
    parts.extend(image_part(image) for image in images)
    return parts


def dump_content(content: str | list[ContentPart]) -> str | list[dict[str, Any]]:
    """Render typed content into the request-dict shape at the wire boundary."""
    if isinstance(content, str):
        return content
    return [part.model_dump() for part in content]


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
