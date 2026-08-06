"""Geometry and encoding the image transform nodes share.

Kept apart from the nodes so the Pillow handling is one testable surface:
re-encoding and clipping are where an awkward source image bites.
"""

from __future__ import annotations

import io
import logging
from math import ceil
from pathlib import PurePosixPath

from PIL import Image
from pydantic import BaseModel

from app.retrieval.parsers.media import FALLBACK_MEDIA_TYPE

logger = logging.getLogger(__name__)


class TilePlacement(BaseModel):
    """Where one tile sits in the grid its source image was split into."""

    index: int
    row: int
    column: int
    rows: int
    columns: int

    @classmethod
    def at(cls, index: int, rows: int, columns: int) -> TilePlacement:
        """Place the `index`-th tile of a grid, counted row-major."""
        return cls(
            index=index,
            row=index // columns,
            column=index % columns,
            rows=rows,
            columns=columns,
        )

    def metadata(self) -> dict[str, object]:
        """The placement as metadata keys on the tile's item."""
        return {
            "tile_index": self.index,
            "tile_row": self.row,
            "tile_column": self.column,
            "tile_rows": self.rows,
            "tile_columns": self.columns,
        }


def derived_name_stem(path: str) -> str:
    """The source asset's filename without its extension.

    Derived names are built from it so a re-run overwrites what the last
    run wrote instead of accumulating a copy per run; the stem is already
    unique within the document's derived directory.
    """
    return PurePosixPath(path).stem


def fit_within(
    width: int, height: int, max_width: int, max_height: int
) -> tuple[int, int] | None:
    """The size fitting inside the box, or None when the image already does.

    Never upscales: added pixels carry no detail the source did not have,
    and cost bytes on every request that inlines the image. The scaled
    edges are rounded and clamped, so the constraining axis lands on the
    box rather than a pixel short of it through float truncation.
    """
    if width <= max_width and height <= max_height:
        return None
    scale = min(max_width / width, max_height / height)
    return (
        max(1, min(max_width, round(width * scale))),
        max(1, min(max_height, round(height * scale))),
    )


def axis_tiles(extent: int, tile: int, stride: int) -> int:
    """How many tiles cover one axis, the last one clipped to the image."""
    if extent <= tile:
        return 1
    return 1 + ceil((extent - tile) / stride)


def encode_image(
    image: Image.Image, image_format: str | None, media_type: str
) -> tuple[bytes, str]:
    """Re-encode an image, keeping its source format where that is writable.

    Keeping the format keeps the asset's recorded media type true of its
    bytes. Pillow reads formats it cannot write, and rejects modes a format
    cannot hold (RGBA in JPEG), so a failed save falls back to PNG.
    """
    buffer = io.BytesIO()
    if image_format:
        try:
            image.save(buffer, format=image_format)
        except (OSError, ValueError, KeyError):
            logger.warning("Re-encoding as PNG: %s cannot be written", image_format)
            buffer = io.BytesIO()
        else:
            return buffer.getvalue(), media_type
    image.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue(), FALLBACK_MEDIA_TYPE
