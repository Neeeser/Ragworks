"""Image transform nodes: resize and tile the image items in a stream.

Both nodes rewrite the stored asset of the image items they receive and
pass every other item through, so either drops in anywhere after parsing
with no router. They are the image modality's oversize handling, bounded
by a vision model's pixel budget the way chunking is bounded by a token
budget.
"""

from __future__ import annotations

import io
import logging
from typing import TypeVar

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, model_validator

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.image_assets import store_derived_image
from app.pipelines.node import PipelineNodeBase
from app.pipelines.nodes.image_ops import (
    TilePlacement,
    axis_tiles,
    derived_name_stem,
    encode_image,
    fit_within,
)
from app.pipelines.nodes.item_summaries import image_summary
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.media import media_type_suffix

logger = logging.getLogger(__name__)

#: Long edge every current vision provider downsamples to. Pixels above it
#: are encoded, uploaded, and thrown away by the provider.
VISION_LONG_EDGE = 1568

TransformConfigT = TypeVar("TransformConfigT", bound=BaseModel)

#: Image items are transformed, everything else rides through — which is
#: what lets these nodes sit in a mixed text/image stream unrouted.
IMAGE_INPUT_PORT = NodePort(
    key="items",
    label="Items",
    data_type=PortKind.ITEMS,
    accepts=(Facet.IMAGE,),
    unaccepted="passthrough",
)
#: The node changes an asset, not what the stream guarantees, so it adds
#: no facet and preserves the ones its input carried.
IMAGE_OUTPUT_PORT = NodePort(
    key="items", label="Items", data_type=PortKind.ITEMS, preserves=True
)


class ImageTransformNodeBase(PipelineNodeBase[TransformConfigT]):
    """Rewrite the image items in a stream, passing every other item through.

    Subclasses implement `transform` for one accepted item and report the
    run's counters through `stats`, which the base records in the trace
    under `stats_label`.
    """

    input_ports = (IMAGE_INPUT_PORT,)
    output_ports = (IMAGE_OUTPUT_PORT,)
    category = "ingestion"
    #: Trace label this node's `stats()` is recorded under.
    stats_label = "Images"

    def __init__(self, config: TransformConfigT) -> None:
        """Initialize the node, its warning stash, and its counters."""
        super().__init__(config)
        self._warnings: list[str] = []
        self.reset_stats()

    def transform(self, item: Item, context: PipelineRunContext) -> list[Item]:
        """Return what one image item becomes. Implemented per transform."""
        raise NotImplementedError

    def reset_stats(self) -> None:
        """Clear the per-run counters `stats` reports."""
        raise NotImplementedError

    def stats(self) -> dict[str, object]:
        """Return this run's counters for the trace."""
        raise NotImplementedError

    def finalize(self, produced: list[Item]) -> list[Item]:
        """Return the transformed items in the form the node emits them."""
        return produced

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Transform the image items and pass every other item through."""
        self._warnings = []
        self.reset_stats()
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, IMAGE_INPUT_PORT)
        produced: list[Item] = []
        for item in partition.accepted:
            produced.extend(self.transform(item, context))
        merged = partition.merge(self.finalize(produced))
        return {"items": batch.model_copy(update={"items": merged})}

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        """Summarize the images read, the items emitted, and the counters."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        output_values = [
            NodeTraceValue(label="Items", value=image_summary(output_batch)),
            NodeTraceValue(
                label="Output items", value=trace_items(output_batch.items), kind="items"
            ),
            NodeTraceValue(label=self.stats_label, value=self.stats()),
        ]
        if self._warnings:
            output_values.append(NodeTraceValue(label="Warnings", value=list(self._warnings)))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(label="Images", value=image_summary(input_batch)),
                partition_trace_value(
                    partition_items(input_batch.items, IMAGE_INPUT_PORT),
                    label="Passed through",
                ),
            ],
            outputs=output_values,
        )

    def open_image(self, item: Item, context: PipelineRunContext) -> Image.Image | None:
        """Decode an item's stored image, or record why it could not be read.

        Bytes Pillow cannot decode leave the item untouched: an image the
        run already stored and indexes as a match is metadata trouble, not
        a reason to fail the document. A missing file still raises — the
        upstream node claimed to have written it.
        """
        asset = image_asset(item)
        data = context.storage.read_bytes(asset.path)
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except (UnidentifiedImageError, OSError, ValueError):
            logger.warning("Could not decode image %s (%s bytes)", asset.path, len(data))
            self._warnings.append(
                f"Could not read the image on '{item.id}' — passed through unchanged."
            )
            return None
        return image


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
        """Clear the resized and unchanged counts."""
        self._resized = 0
        self._unchanged = 0

    def stats(self) -> dict[str, object]:
        """How many images were rewritten and how many already fitted."""
        return {"resized": self._resized, "unchanged": self._unchanged}

    def transform(self, item: Item, context: PipelineRunContext) -> list[Item]:
        """Return the item with a resized asset, or unchanged if it fits.

        An image already inside the box keeps its asset: the bytes would be
        identical, and writing a copy per run grows storage for nothing.
        """
        asset = image_asset(item)
        image = self.open_image(item, context)
        if image is None:
            self._unchanged += 1
            return [item]
        with image:
            target = fit_within(
                image.width, image.height, self.config.max_width, self.config.max_height
            )
            if target is None:
                self._unchanged += 1
                return [item]
            resized = image.resize(target, Image.Resampling.LANCZOS)
            data, media_type = encode_image(resized, image.format, asset.media_type)
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
        ge=1,
        description=(
            "Width of each tile, in pixels. Tiles along the right edge are "
            "clipped to the image rather than padded."
        ),
    )
    tile_height: int = Field(
        default=1024, ge=1, description="Height of each tile, in pixels."
    )
    overlap: int = Field(
        default=0,
        ge=0,
        description=(
            "Pixels adjacent tiles share on both axes, so content on a tile "
            "boundary stays whole in one of them. The stride between tiles "
            "is the tile size minus this."
        ),
    )

    @model_validator(mode="after")
    def validate_overlap(self) -> ImageTileConfig:
        """Keep the stride positive on both axes."""
        if self.overlap >= self.tile_width or self.overlap >= self.tile_height:
            raise ValueError("Overlap must be smaller than both the tile width and height.")
        return self


class ImageTileNode(ImageTransformNodeBase[ImageTileConfig]):
    """Split each image item into a grid of tiles, one item per tile."""

    type = "image.tile"
    label = "Split Images into Tiles"
    description = "Split each image into a grid of tiles, emitting one item per tile."
    example = "Items(1 image 2048x1024) -> Items(2 images 1024x1024)."
    config_model = ImageTileConfig
    stats_label = "Tiles"

    def reset_stats(self) -> None:
        """Clear the tiled-image counts and the last grid."""
        self._sources = 0
        self._tiles = 0
        self._grid: str | None = None

    def stats(self) -> dict[str, object]:
        """How many images were split, into how many tiles, on what grid."""
        counts: dict[str, object] = {"sources": self._sources, "tiles": self._tiles}
        if self._grid is not None:
            counts["grid"] = self._grid
        return counts

    def transform(self, item: Item, context: PipelineRunContext) -> list[Item]:
        """Return one item per tile, or the item unchanged if it fits in one."""
        image = self.open_image(item, context)
        if image is None:
            return [item]
        with image:
            columns = axis_tiles(image.width, self.config.tile_width, self._stride_x())
            rows = axis_tiles(image.height, self.config.tile_height, self._stride_y())
            if rows == 1 and columns == 1:
                return [item]
            tiles = [
                self._store_tile(image, item, TilePlacement.at(index, rows, columns), context)
                for index in range(rows * columns)
            ]
        self._sources += 1
        self._tiles += len(tiles)
        self._grid = f"{rows}x{columns}"
        return tiles

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

    def _stride_x(self) -> int:
        """Horizontal distance between adjacent tiles' left edges."""
        return self.config.tile_width - self.config.overlap

    def _stride_y(self) -> int:
        """Vertical distance between adjacent tiles' top edges."""
        return self.config.tile_height - self.config.overlap

    def _store_tile(
        self,
        image: Image.Image,
        source: Item,
        placement: TilePlacement,
        context: PipelineRunContext,
    ) -> Item:
        """Crop, store, and wrap one tile of a source image."""
        asset = image_asset(source)
        left = placement.column * self._stride_x()
        top = placement.row * self._stride_y()
        tile = image.crop(
            (
                left,
                top,
                min(left + self.config.tile_width, image.width),
                min(top + self.config.tile_height, image.height),
            )
        )
        data, media_type = encode_image(tile, image.format, asset.media_type)
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
                "order": placement.index,
                "metadata": DocumentMetadata(
                    data={**source.metadata.data, **placement.metadata()}
                ),
            }
        )


def image_asset(item: Item) -> MediaAsset:
    """The image an accepted item carries; partitioning guarantees one."""
    if item.image is None:
        raise ValueError(f"Item '{item.id}' carries no image.")
    return item.image
