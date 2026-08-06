"""The shared shape of an image transform node.

An image transform rewrites the stored asset of the image items it
receives and passes every other item through, so it drops in anywhere
after parsing with no router. The base owns the ports, the partitioning,
the decode, and the trace summary; a subclass supplies `transform` for
one accepted item and the counters `stats` reports.
"""

from __future__ import annotations

import io
import logging
from typing import TypeVar

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.nodes.image_ops import frame_count, orient
from app.pipelines.nodes.item_summaries import image_summary
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue

logger = logging.getLogger(__name__)

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
#: The node changes an asset, not an item's identity, so it adds no facet
#: and preserves the ones its input carried — except the annotations
#: computed from the pixels it just rewrote.
IMAGE_OUTPUT_PORT = NodePort(
    key="items",
    label="Items",
    data_type=PortKind.ITEMS,
    preserves=True,
    removes=(Facet.EMBEDDING, Facet.SCORE),
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
        """Clear the counters every image transform reports."""
        self._unchanged = 0
        self._unreadable = 0

    def measured_stats(self) -> dict[str, object]:
        """Images measured and left alone, and images never decoded.

        The two are counted apart because they mean opposite things: one
        image was read and found to need nothing, the other was never
        read at all.
        """
        return {"unchanged": self._unchanged, "unreadable": self._unreadable}

    def stats(self) -> dict[str, object]:
        """Return this run's counters for the trace."""
        raise NotImplementedError

    def finalize(self, produced: list[Item]) -> list[Item]:
        """Return the transformed items in the form the node emits them."""
        return produced

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Transform the image items and pass every other item through.

        An item whose pixels were rewritten loses the annotations computed
        from the old ones. A `transform` that made no change hands back the
        item it was given, and that item keeps its vector — the subclasses'
        no-op paths (an image already inside the box, bytes that would not
        decode, a grid over the tile cap) are exactly those.
        """
        self._warnings = []
        self.reset_stats()
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, IMAGE_INPUT_PORT)
        produced: list[Item] = []
        for item in partition.accepted:
            produced.extend(
                result if result is item else result.without_derived_facets()
                for result in self.transform(item, context)
            )
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

        An animation is transformed as its first frame, which is what a
        vision model reads from it anyway; the warning says how many
        frames went with the rest.
        """
        asset = image_asset(item)
        data = context.storage.read_bytes(asset.path)
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except (UnidentifiedImageError, OSError, ValueError):
            logger.warning("Could not decode image %s (%s bytes)", asset.path, len(data))
            self._unreadable += 1
            self._warnings.append(
                f"Could not read the image on '{item.id}' — passed through unchanged."
            )
            return None
        frames = frame_count(image)
        if frames > 1:
            self._warnings.append(
                f"'{item.id}' holds {frames} frames; the first was transformed "
                "and the rest were dropped."
            )
        return orient(image)

def image_asset(item: Item) -> MediaAsset:
    """The image an accepted item carries; partitioning guarantees one."""
    if item.image is None:
        raise ValueError(f"Item '{item.id}' carries no image.")
    return item.image
