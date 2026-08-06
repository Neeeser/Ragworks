"""Image bytes an extractor produced, and the encoding rules they follow.

Kept apart from the handlers so the Pillow handling is one testable
surface: decoding is where malformed input actually bites.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

from app.providers.chat.content import (
    IMAGE_EXTENSION_BY_MEDIA_TYPE,
    SUPPORTED_IMAGE_MEDIA_TYPES,
)

logger = logging.getLogger(__name__)

#: What an extracted image is re-encoded to when its source encoding is
#: not one every provider accepts. PDF images are routinely CMYK JPEG,
#: 1-bit masks, or raw bitmaps; PNG is lossless and universally accepted,
#: so normalizing costs nothing a model can see.
FALLBACK_MEDIA_TYPE = "image/png"

_MEDIA_TYPE_BY_FORMAT = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "GIF": "image/gif",
    "WEBP": "image/webp",
}


def media_type_for_format(image_format: str | None) -> str | None:
    """The media type of bytes written in a Pillow format, or None if unnamed.

    Pillow writes more formats than this app can name a media type for, and
    a stored asset whose recorded type does not describe its bytes reaches
    providers as a rejected request.
    """
    if not image_format:
        return None
    return _MEDIA_TYPE_BY_FORMAT.get(image_format.upper())


@dataclass(frozen=True)
class ExtractedImage:
    """One image pulled out of a document, ready to store."""

    name: str
    data: bytes
    media_type: str
    page: int
    index: int
    width: int | None
    height: int | None


def normalize_image(data: bytes) -> tuple[bytes, str, int, int] | None:
    """Return (bytes, media type, width, height) in a provider-accepted form.

    An image already in an accepted encoding is passed through untouched;
    anything else is re-encoded to PNG. Undecodable images return None —
    they are page artifacts far more often than content.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = image.format or ""
            width, height = image.width, image.height
            media_type = media_type_for_format(image_format)
            if media_type in SUPPORTED_IMAGE_MEDIA_TYPES:
                return (data, media_type, width, height)
            converted = image.convert("RGB")
            buffer = io.BytesIO()
            converted.save(buffer, format="PNG")
            return (buffer.getvalue(), FALLBACK_MEDIA_TYPE, width, height)
    except (UnidentifiedImageError, OSError, ValueError):
        logger.warning("Skipping an undecodable embedded image (%s bytes)", len(data))
        return None


def media_type_suffix(media_type: str) -> str:
    """File extension for a media type, so stored assets are recognizable."""
    return IMAGE_EXTENSION_BY_MEDIA_TYPE.get(media_type, ".bin")
