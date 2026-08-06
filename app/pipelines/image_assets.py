"""Reading stored images back for the nodes that send them to a model.

Extraction lives in `app/retrieval/parsers/`; what remains here is the
read side every image-consuming node shares.
"""

from __future__ import annotations

import io
import logging

from PIL import Image, UnidentifiedImageError

from app.schemas.media import InlineMedia
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage

logger = logging.getLogger(__name__)


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


def load_inline_media(storage: FileStorage, *, media_type: str, path: str) -> InlineMedia:
    """Read a stored image for inlining into a model request, capped by config.

    The image size limit applies here as well as at upload, because a
    limit lowered after files landed must still hold: inlining recurs on
    every describe, embed, and chat turn, so an oversized stored image
    raises rather than shipping megabytes per call.
    """
    limit_mb = get_app_config().uploads.max_image_upload_size_mb
    data = storage.read_bytes(path)
    if len(data) > limit_mb * 1024 * 1024:
        raise InvalidInputError(
            f"Image '{path}' is larger than the configured {limit_mb}MB image limit."
        )
    return InlineMedia(media_type=media_type, data=data)
