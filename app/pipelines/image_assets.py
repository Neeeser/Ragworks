"""Reading images out of files, for the nodes that produce image items.

Kept apart from the nodes so the Pillow/pypdf handling is one testable
surface: decoding is where malformed input actually bites, and a node
should be about ports and tracing.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader

from app.providers.chat.content import SUPPORTED_IMAGE_MEDIA_TYPES

logger = logging.getLogger(__name__)

#: What an extracted image is re-encoded to when its source encoding is
#: not one every provider accepts. PDF images are routinely CMYK JPEG,
#: 1-bit masks, or raw bitmaps; PNG is lossless and universally accepted,
#: so normalizing costs nothing a model can see.
_FALLBACK_MEDIA_TYPE = "image/png"

_MEDIA_TYPE_BY_FORMAT = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "GIF": "image/gif",
    "WEBP": "image/webp",
}


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


def read_image_dimensions(data: bytes) -> tuple[int | None, int | None]:
    """Return an image's pixel dimensions, or (None, None) if unreadable.

    Dimensions are metadata a match renders with, never something a run
    depends on, so an image whose header this cannot parse is still
    ingested rather than failing the document.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            return image.width, image.height
    except (UnidentifiedImageError, OSError, ValueError):
        logger.warning("Could not read image dimensions from %s bytes", len(data))
        return (None, None)


def extracted_pdf_images(
    path: Path, *, min_width: int, min_height: int
) -> list[ExtractedImage]:
    """Return the PDF's embedded images above the size floor, in page order.

    A page whose images cannot be decoded is skipped with a warning rather
    than failing the document: one malformed XObject in a hundred-page
    report should not cost the other ninety-nine pages.
    """
    reader = PdfReader(str(path))
    images: list[ExtractedImage] = []
    for page_number, page in enumerate(reader.pages, start=1):
        try:
            page_images = list(page.images)
        except Exception:  # pypdf raises a wide family on malformed streams
            logger.warning("Could not read images from PDF page %s", page_number)
            continue
        for embedded in page_images:
            normalized = _normalize(embedded.data)
            if normalized is None:
                continue
            data, media_type, width, height = normalized
            if width < min_width or height < min_height:
                continue
            index = len(images)
            images.append(
                ExtractedImage(
                    name=f"page{page_number}-{index}{_suffix(media_type)}",
                    data=data,
                    media_type=media_type,
                    page=page_number,
                    index=index,
                    width=width,
                    height=height,
                )
            )
    return images


def _normalize(data: bytes) -> tuple[bytes, str, int, int] | None:
    """Return (bytes, media type, width, height) in a provider-accepted form.

    An image already in an accepted encoding is passed through untouched;
    anything else is re-encoded to PNG. Undecodable images return None —
    they are page artifacts far more often than content.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = image.format or ""
            width, height = image.width, image.height
            media_type = _MEDIA_TYPE_BY_FORMAT.get(image_format)
            if media_type in SUPPORTED_IMAGE_MEDIA_TYPES:
                return (data, media_type, width, height)
            converted = image.convert("RGB")
            buffer = io.BytesIO()
            converted.save(buffer, format="PNG")
            return (buffer.getvalue(), _FALLBACK_MEDIA_TYPE, width, height)
    except (UnidentifiedImageError, OSError, ValueError):
        logger.warning("Skipping an undecodable embedded image (%s bytes)", len(data))
        return None


def _suffix(media_type: str) -> str:
    """File extension for a media type, so stored assets are recognizable."""
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }.get(media_type, ".bin")
