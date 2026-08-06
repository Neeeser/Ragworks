"""Geometry and encoding the image transform nodes share.

Kept apart from the nodes so the Pillow handling is one testable surface:
re-encoding and clipping are where an awkward source image bites.
"""

from __future__ import annotations

import io
import logging
from math import ceil
from pathlib import PurePosixPath

from PIL import Image, ImageOps
from pydantic import BaseModel

from app.retrieval.parsers.media import FALLBACK_MEDIA_TYPE, media_type_for_format

logger = logging.getLogger(__name__)

#: Smallest tile edge a grid may be cut at. Below it a crop holds a few
#: characters of a page, and the tile count climbs by the square.
MIN_TILE_EDGE = 64
#: Most tiles one image is split into; above it the image is left whole.
#: A 600-DPI A3 scan needs about 70 tiles at the default size, so a grid
#: past this is a mistyped tile size, and every tile is encoded and
#: written before anything downstream sees the run.
MAX_TILES_PER_IMAGE = 256


class TilePlacement(BaseModel):
    """Where one tile sits in the grid its source image was split into."""

    index: int
    row: int
    column: int
    rows: int
    columns: int

    @classmethod
    def at(cls, index: int, grid: TileGrid) -> TilePlacement:
        """Place the `index`-th tile of a grid, counted row-major."""
        return cls(
            index=index,
            row=index // grid.columns,
            column=index % grid.columns,
            rows=grid.rows,
            columns=grid.columns,
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


class TileGrid(BaseModel):
    """The grid one image is cut into, and where each tile lands in it."""

    columns: int
    rows: int
    tile_width: int
    tile_height: int
    stride_x: int
    stride_y: int

    @classmethod
    def plan(
        cls, width: int, height: int, *, tile_width: int, tile_height: int, overlap: int
    ) -> TileGrid:
        """Cover a `width` by `height` image, clipping the last tile of each axis."""
        stride_x = tile_width - overlap
        stride_y = tile_height - overlap
        return cls(
            columns=axis_tiles(width, tile_width, stride_x),
            rows=axis_tiles(height, tile_height, stride_y),
            tile_width=tile_width,
            tile_height=tile_height,
            stride_x=stride_x,
            stride_y=stride_y,
        )

    @property
    def count(self) -> int:
        """How many tiles the grid holds."""
        return self.columns * self.rows

    @property
    def label(self) -> str:
        """Columns by rows — the order every dimension string in a trace uses."""
        return f"{self.columns}x{self.rows}"

    def box(self, placement: TilePlacement, width: int, height: int) -> tuple[int, int, int, int]:
        """The crop box of one tile, clipped to the image rather than padded."""
        left = placement.column * self.stride_x
        top = placement.row * self.stride_y
        return (left, top, min(left + self.tile_width, width), min(top + self.tile_height, height))


def derived_name_stem(path: str) -> str:
    """The source asset's filename without its extension.

    Derived names are built from it so a re-run overwrites what the last
    run wrote instead of accumulating a copy per run; the stem is already
    unique within the document's derived directory.
    """
    return PurePosixPath(path).stem


def frame_count(image: Image.Image) -> int:
    """How many frames an image holds; 1 for every still format."""
    frames = getattr(image, "n_frames", 1)
    return frames if isinstance(frames, int) else 1


def orient(image: Image.Image) -> Image.Image:
    """Return the image as it displays, with its EXIF orientation applied.

    A camera stores the sensor's pixels and records the quarter turn a
    viewer must apply. Reading the stored pixels leaves a photo rotated
    against its source, records the un-turned width and height, and cuts a
    tile grid on the wrong axes. The transposed image is a new one and
    Pillow drops the source format off it, so the format is carried over —
    re-encoding reads it to keep the media type true.
    """
    oriented = ImageOps.exif_transpose(image)
    if oriented is None or oriented is image:
        return image
    oriented.format = image.format
    image.close()
    return oriented


def resample_ready(image: Image.Image) -> Image.Image:
    """Return an image Pillow will resample with the filter it was given.

    Pillow forces nearest-neighbour for palette and 1-bit images, so a
    downsampled scan or line drawing comes out of a LANCZOS call with a
    handful of pixels' colours and none of the detail between them.
    """
    if image.mode not in {"P", "1"}:
        return image
    return image.convert("RGBA" if "transparency" in image.info else "RGB")


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


#: Encoder settings for the lossy formats. Pillow's defaults (JPEG
#: quality 75, WebP 80) shift channels by a third of their range on one
#: pass, and a resize feeding a tile node re-encodes twice.
_SAVE_OPTIONS: dict[str, dict[str, object]] = {
    "image/jpeg": {"quality": 95},
    "image/webp": {"quality": 95},
}


def encode_image(image: Image.Image, image_format: str | None) -> tuple[bytes, str]:
    """Re-encode an image, returning its bytes and the media type they are.

    The source format is kept when it is one this app names a media type
    for, so the returned type always describes the bytes beside it. Pillow
    reads formats it cannot write, and rejects modes a format cannot hold
    (RGBA in JPEG), so a failed save falls back to PNG as well.
    """
    buffer = io.BytesIO()
    media_type = media_type_for_format(image_format)
    if image_format and media_type:
        try:
            image.save(buffer, format=image_format, **_SAVE_OPTIONS.get(media_type, {}))
        except (OSError, ValueError, KeyError):
            logger.warning("Re-encoding as PNG: %s cannot be written", image_format)
            buffer = io.BytesIO()
        else:
            return buffer.getvalue(), media_type
    image.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue(), FALLBACK_MEDIA_TYPE
