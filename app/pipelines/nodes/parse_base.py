"""Shared shape for the capability-parsing nodes.

Every parse node reads the same input — a stream that may carry file items
— and consumes the file items it handles, replacing each with what it
extracted. Items of any other modality pass through untouched, so a parse
node inserted mid-stream never destroys data. Which formats a node handles
is registry data (`app/retrieval/parsers/`), never pipeline shape.
"""

from __future__ import annotations

from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue

ParseConfigT = TypeVar("ParseConfigT", bound=BaseModel)

#: The input every parse node declares. File items are consumed; anything
#: else rides through, which is what lets parse nodes fan out in parallel
#: and merge again without a router deciding for them.
PARSE_INPUT_PORT = NodePort(
    key="source",
    label="File",
    data_type=PortKind.ITEMS,
    accepts=(Facet.FILE,),
    unaccepted="passthrough",
)


class ParseNodeBase(PipelineNodeBase[ParseConfigT]):
    """Dispatch each file item to its content type's handler.

    Subclasses declare their registry (`handled_content_types`) and
    implement `parse_file`, returning the items one file produced. A file
    whose type the registry does not answer for follows `unhandled`,
    whose default records a trace warning and emits nothing.
    """

    input_ports = (PARSE_INPUT_PORT,)
    category = "parsing"

    def __init__(self, config: ParseConfigT) -> None:
        """Initialize the node and its per-run warning stash."""
        super().__init__(config)
        self._warnings: list[str] = []

    def parse_file(
        self, item: Item, path: Path, media_type: str, context: PipelineRunContext
    ) -> list[Item]:
        """Return the items one file item produced. Implemented per capability."""
        raise NotImplementedError

    def handles(self, media_type: str) -> bool:
        """True when this node's registry answers for a content type."""
        return media_type in (self.handled_content_types or frozenset())

    def unhandled(self, item: Item, media_type: str, path: Path) -> list[Item] | None:
        """Answer for a type the registry does not cover, or decline it.

        `None` declines: this node read nothing, and the run records the
        file as unread by it. A subclass whose configuration says to try
        anyway (Extract Text decoding unknown formats) returns items
        instead, which counts as having read the file.
        """
        self._warnings.append(
            f"No {self.label} handler for '{media_type}' — '{item.id}' produced nothing."
        )
        return None

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Parse the file items and pass every other item through."""
        self._warnings = []
        batch = ItemBatch.model_validate(inputs.get("source"))
        partition = partition_items(batch.items, PARSE_INPUT_PORT)
        produced: list[Item] = []
        for item in partition.accepted:
            asset = _file_asset(item)
            path = context.storage.resolve(asset.path)
            if not path.exists():
                raise FileNotFoundError(f"Stored file not found: {asset.path}")
            media_type = asset.media_type.lower()
            read = (
                self.parse_file(item, path, media_type, context)
                if self.handles(media_type)
                else self.unhandled(item, media_type, path)
            )
            if read is None:
                context.parse_report.record_unhandled(item.id, media_type)
                continue
            context.parse_report.record_handled(item.id)
            produced.extend(read)
        return {"items": batch.model_copy(update={"items": partition.merge(produced)})}

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        """Summarize the files read and the items they produced."""
        input_batch = ItemBatch.model_validate(inputs.get("source"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        outputs_values = [
            NodeTraceValue(label="Items", value=self.output_summary(output_batch)),
            NodeTraceValue(
                label="Parsed items", value=trace_items(output_batch.items), kind="items"
            ),
        ]
        if self._warnings:
            outputs_values.append(NodeTraceValue(label="Warnings", value=list(self._warnings)))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(label="Files", value=_files_summary(input_batch)),
                partition_trace_value(
                    partition_items(input_batch.items, PARSE_INPUT_PORT), label="Passed through"
                ),
            ],
            outputs=outputs_values,
        )

    def output_summary(self, batch: ItemBatch) -> dict[str, object]:
        """Describe what this node emitted. Overridden per capability."""
        return {"count": len(batch.items)}


def _file_asset(item: Item) -> MediaAsset:
    """The file an accepted item carries; partitioning guarantees one."""
    if item.file is None:
        raise ValueError(f"Item '{item.id}' carries no file.")
    return item.file


def _files_summary(batch: ItemBatch) -> dict[str, object]:
    """Describe the file items arriving at a parse node."""
    files = [item.file for item in batch.items if item.file is not None]
    return {
        "count": len(files),
        "media_types": sorted({asset.media_type for asset in files}),
    }


def image_summary(batch: ItemBatch) -> dict[str, object]:
    """Describe an image stream: how many, of what, and how big."""
    images = [item.image for item in batch.items if item.image is not None]
    return {
        "count": len(images),
        "media_types": sorted({image.media_type for image in images}),
        "dimensions": [
            f"{image.width}x{image.height}" if image.width and image.height else "unknown"
            for image in images[:10]
        ],
    }
