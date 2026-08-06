"""Image transform nodes: resize and tile the image items in a stream.

They are the image modality's oversize handling, bounded by a vision
model's pixel budget the way chunking is bounded by a token budget:
resize fits an image inside a box, tile cuts one that needs its detail
kept into a grid.
"""

from __future__ import annotations

from PIL import Image
from pydantic import BaseModel, Field, model_validator

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.image_assets import store_derived_image
from app.pipelines.nodes.image_ops import (
    MAX_TILES_PER_IMAGE,
    MIN_TILE_EDGE,
    TileGrid,
    TilePlacement,
    derived_name_stem,
    encode_image,
    fit_within,
    resample_ready,
)
from app.pipelines.nodes.image_transform_base import ImageTransformNodeBase, image_asset
from app.pipelines.payloads import Item, MediaAsset
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.media import media_type_suffix

#: Long edge every current vision provider downsamples to. Pixels above it
#: are encoded, uploaded, and thrown away by the provider.
VISION_LONG_EDGE = 1568


class ImageResizeConfig(BaseModel):
    """Configuration for fitting images inside a pixel box."""

    max_width: int = Field(
        default=VISION_LONG_EDGE,
        ge=1,
        description=(
            "Widest an image is kept, in pixels. Vision providers downsample "
            f"above roughly {VISION_LONG_EDGE} pixels on the long edge, so "
            "pixels above the box are stored and uploaded to be discarded."
        ),
    )
    max_height: int = Field(
        default=VISION_LONG_EDGE,
        ge=1,
        description="Tallest an image is kept, in pixels.",
    )


class ImageResizeNode(ImageTransformNodeBase[ImageResizeConfig]):
    """Fit each image item inside a maximum width and height."""

    type = "image.resize"
    label = "Resize Images"
    description = "Fit each image inside a maximum width and height, keeping its aspect ratio."
    example = "Items(1 image 3000x2000) -> Items(1 image 1568x1045)."
    config_model = ImageResizeConfig
    stats_label = "Resized"

    def reset_stats(self) -> None:
        """Clear the resized count alongside the shared counters."""
        super().reset_stats()
        self._resized = 0

    def stats(self) -> dict[str, object]:
        """How many images were rewritten, already fitted, or never read."""
        return {"resized": self._resized, **self.measured_stats()}

    def transform(self, item: Item, context: PipelineRunContext) -> list[Item]:
        """Return the item with a resized asset, or unchanged if it fits.

        An image already inside the box keeps its asset: the bytes would be
        identical, and writing a copy per run grows storage for nothing.
        """
        asset = image_asset(item)
        image = self.open_image(item, context)
        if image is None:
            return [item]
        with image:
            target = fit_within(
                image.width, image.height, self.config.max_width, self.config.max_height
            )
            if target is None:
                self._unchanged += 1
                return [item]
            resized = resample_ready(image).resize(target, Image.Resampling.LANCZOS)
            data, media_type = encode_image(resized, image.format)
        name = f"{derived_name_stem(asset.path)}-r{target[0]}x{target[1]}{media_type_suffix(media_type)}"
        path = store_derived_image(
            context.storage,
            data,
            collection_id=context.collection.id,
            document_id=item.document_id or item.id,
            name=name,
        )
        self._resized += 1
        return [
            item.model_copy(
                update={
                    "image": MediaAsset(
                        media_type=media_type,
                        path=path,
                        byte_size=len(data),
                        width=target[0],
                        height=target[1],
                    )
                }
            )
        ]


class ImageTileConfig(BaseModel):
    """Configuration for splitting images into a grid of tiles."""

    tile_width: int = Field(
        default=1024,
        ge=MIN_TILE_EDGE,
        description=(
            "Width of each tile, in pixels, at least "
            f"{MIN_TILE_EDGE}. Tiles along the right edge are clipped to the "
            "image rather than padded."
        ),
    )
    tile_height: int = Field(
        default=1024,
        ge=MIN_TILE_EDGE,
        description=f"Height of each tile, in pixels, at least {MIN_TILE_EDGE}.",
    )
    overlap: int = Field(
        default=0,
        ge=0,
        description=(
            "Pixels adjacent tiles share on both axes, so content on a tile "
            "boundary stays whole in one of them. The stride between tiles "
            "is the tile size minus this, and the overlap may be at most "
            "half the tile width and half the tile height — above that a "
            "tile is mostly a copy of its neighbour."
        ),
    )

    @model_validator(mode="after")
    def validate_overlap(self) -> ImageTileConfig:
        """Keep every tile mostly content its neighbour does not carry.

        Each axis is checked on its own: a tile wide enough for the
        overlap says nothing about whether it is tall enough, and a
        negative vertical stride makes the grid cover no rows at all, so
        the image would drop out of the stream.
        """
        for axis, extent in (("width", self.tile_width), ("height", self.tile_height)):
            if self.overlap > extent // 2:
                raise ValueError(
                    f"Overlap must be at most half the tile {axis} ({extent // 2} pixels)."
                )
        return self


class ImageTileNode(ImageTransformNodeBase[ImageTileConfig]):
    """Split each image item into a grid of tiles, one item per tile."""

    type = "image.tile"
    label = "Split Images into Tiles"
    description = (
        "Split each image into a grid of tiles, emitting one item per tile. "
        f"An image whose grid would exceed {MAX_TILES_PER_IMAGE} tiles is left whole."
    )
    example = "Items(1 image 2048x1024) -> Items(2 images 1024x1024)."
    config_model = ImageTileConfig
    stats_label = "Tiles"

    def reset_stats(self) -> None:
        """Clear the tiled-image counts alongside the shared counters."""
        super().reset_stats()
        self._sources = 0
        self._tiles = 0
        self._grid: str | None = None

    def stats(self) -> dict[str, object]:
        """How many images were split, into how many tiles, on what grid.

        The grid is reported only while one image was split: two images
        have no shared grid, and naming the last one describes the run's
        other tiles wrongly.
        """
        counts: dict[str, object] = {
            "sources": self._sources,
            "tiles": self._tiles,
            **self.measured_stats(),
        }
        if self._grid is not None:
            counts["grid"] = self._grid
        return counts

    def transform(self, item: Item, context: PipelineRunContext) -> list[Item]:
        """Return one item per tile, or the item unchanged if it fits in one."""
        image = self.open_image(item, context)
        if image is None:
            return [item]
        with image:
            grid = TileGrid.plan(
                image.width,
                image.height,
                tile_width=self.config.tile_width,
                tile_height=self.config.tile_height,
                overlap=self.config.overlap,
            )
            if grid.count == 1 or not self._within_the_cap(grid, item):
                self._unchanged += 1
                return [item]
            tiles = [
                self._store_tile(image, item, TilePlacement.at(index, grid), grid, context)
                for index in range(grid.count)
            ]
        self._sources += 1
        self._tiles += len(tiles)
        self._grid = grid.label if self._sources == 1 else None
        return tiles

    def _within_the_cap(self, grid: TileGrid, item: Item) -> bool:
        """Whether a grid is small enough to cut, warning when it is not.

        Every tile is cropped, encoded, and written before the run
        continues, so a tile size that misses by an order of magnitude
        would spend the ingestion on crops nobody asked for.
        """
        if grid.count <= MAX_TILES_PER_IMAGE:
            return True
        self._warnings.append(
            f"'{item.id}' would split into a {grid.label} grid ({grid.count} tiles), "
            f"above the limit of {MAX_TILES_PER_IMAGE} — passed through unchanged."
        )
        return False

    def finalize(self, produced: list[Item]) -> list[Item]:
        """Number a document's image items in stream order once tiling split one.

        `order` becomes the `chunk_index` a document's rows are keyed by, so
        a tile cannot carry its index within its own grid: every page would
        restart at zero and the indexes would collide. Numbering runs across
        every image item this node emits for a document, so the indexes stay
        unique and keep document order — including the pages that fitted in
        one tile, whose position shifts as soon as an earlier page becomes
        several items.
        """
        if self._tiles == 0:
            return produced
        next_order: dict[str | None, int] = {}
        renumbered: list[Item] = []
        for item in produced:
            order = next_order.get(item.document_id, 0)
            next_order[item.document_id] = order + 1
            renumbered.append(item.model_copy(update={"order": order}))
        return renumbered

    def _store_tile(
        self,
        image: Image.Image,
        source: Item,
        placement: TilePlacement,
        grid: TileGrid,
        context: PipelineRunContext,
    ) -> Item:
        """Crop, store, and wrap one tile of a source image."""
        asset = image_asset(source)
        tile = image.crop(grid.box(placement, image.width, image.height))
        data, media_type = encode_image(tile, image.format)
        path = store_derived_image(
            context.storage,
            data,
            collection_id=context.collection.id,
            document_id=source.document_id or source.id,
            name=f"{derived_name_stem(asset.path)}-t{placement.index}{media_type_suffix(media_type)}",
        )
        # A tile is the source item with a different crop on it: the output
        # port preserves, so text an upstream node wrote (a page
        # transcription), its embedding, and its score all ride along.
        # `order` is left to `finalize`, which numbers the whole document.
        return source.model_copy(
            update={
                "id": f"{source.id}:tile:{placement.index}",
                "image": MediaAsset(
                    media_type=media_type,
                    path=path,
                    byte_size=len(data),
                    width=tile.width,
                    height=tile.height,
                ),
                "metadata": DocumentMetadata(
                    data={**source.metadata.data, **placement.metadata()}
                ),
            }
        )
