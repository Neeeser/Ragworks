"""Parser capability registries, one per parse node.

Each registry maps a content type to the handler that answers for it, so
adding a format is a registry entry and every pipeline already wiring the
node picks it up.
"""

from .base import (
    EmbeddedMediaHandler,
    EmbeddedMediaRequest,
    PageImageHandler,
    PageImageRequest,
    TextHandler,
    TextRequest,
)
from .embedded_media import EMBEDDED_MEDIA_HANDLERS
from .media import ExtractedImage
from .media_files import MEDIA_FILE_TYPES
from .page_images import PAGE_IMAGE_HANDLERS
from .text import TEXT_HANDLERS, decode_best_effort

__all__ = [
    "EMBEDDED_MEDIA_HANDLERS",
    "MEDIA_FILE_TYPES",
    "PAGE_IMAGE_HANDLERS",
    "TEXT_HANDLERS",
    "EmbeddedMediaHandler",
    "EmbeddedMediaRequest",
    "ExtractedImage",
    "PageImageHandler",
    "PageImageRequest",
    "TextHandler",
    "TextRequest",
    "decode_best_effort",
]
