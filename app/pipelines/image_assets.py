"""The stored-image surface pipeline nodes share.

Extraction lives in `app/retrieval/parsers/`; what remains here is reading
an image back for a model request and writing one a node produced.
"""

from __future__ import annotations

import io
import logging
from uuid import UUID

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


def store_derived_image(
    storage: FileStorage,
    data: bytes,
    *,
    collection_id: UUID | str,
    document_id: str,
    name: str,
) -> str:
    """Write a produced image under the document's derived directory.

    Returns the storage-relative path. `derived_dir` is exactly what the
    delete and re-ingest purges remove, so an image written anywhere else
    outlives the document it was derived from.
    """
    relative = f"{storage.derived_dir(collection_id, document_id)}/{name}"
    storage.write_bytes(data, relative)
    return relative


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
