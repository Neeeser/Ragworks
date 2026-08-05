"""Nodes that bring image content into the items plane.

`image.source` carries an uploaded image in as one item; `pdf.images`
pulls the images embedded in a PDF out as one item each. Both emit items
guaranteeing the `image` facet, which is what lets the rest of the graph —
a vision shell, a multimodal embedder — be ordinary nodes rather than
image-specific machinery.

Per-modality source nodes are deliberate: a generic media-source node
whose output facets depend on the file it happens to receive cannot be
checked statically, and static checking is the whole point of the port
types. Audio and video get their own nodes when they get their own
processing.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.image_assets import (
    ExtractedImage,
    extracted_pdf_images,
    read_image_dimensions,
)
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, SourcePayload
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_source
from app.retrieval.models import DocumentMetadata
from app.schemas.content_types import IMAGE_CONTENT_TYPES
from app.services.errors import InvalidInputError

logger = logging.getLogger(__name__)


class ImageSourceConfig(BaseModel):
    """Configuration for the image source node (no options today)."""


class ImageSourceNode(PipelineNodeBase[ImageSourceConfig]):
    """Emit an uploaded image as a single image-bearing item."""

    type = "image.source"
    label = "Image Source"
    category = "ingestion"
    description = "Read an uploaded image file as one item carrying the image."
    example = "SourcePayload(content_type='image/png') -> Items(1 image)."
    input_ports = (NodePort(key="source", label="Source", data_type=PortKind.DOCUMENT_SOURCE),)
    output_ports = (
        NodePort(key="items", label="Images", data_type=PortKind.ITEMS, adds=(Facet.IMAGE,)),
    )
    config_model = ImageSourceConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Emit the source file as one image item."""
        source = SourcePayload.model_validate(inputs.get("source")).source
        media_type = (source.content_type or "").lower()
        if media_type not in IMAGE_CONTENT_TYPES:
            raise InvalidInputError(
                f"Image source received '{source.content_type or 'unknown'}', which is not a "
                "supported image type. Route non-image files to a parser instead."
            )
        path = Path(source.path)
        if not path.exists():
            raise FileNotFoundError(f"Image file not found: {path}")
        data = path.read_bytes()
        width, height = read_image_dimensions(data)
        asset = MediaAsset(
            media_type=media_type,
            path=context.storage.relative_of(path),
            byte_size=len(data),
            width=width,
            height=height,
        )
        item = Item(
            id=source.document_id,
            image=asset,
            document_id=source.document_id,
            order=0,
            metadata=source.metadata.model_copy(deep=True),
        )
        return {"items": ItemBatch(items=[item])}

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        """Summarize the source and the image item it produced."""
        source = SourcePayload.model_validate(inputs.get("source")).source
        batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[NodeTraceValue(label="Source", value=summarize_source(source))],
            outputs=[NodeTraceValue(label="Image", value=_image_summary(batch))],
        )


class PdfImageExtractorConfig(BaseModel):
    """Configuration for PDF image extraction."""

    min_width: int = Field(
        default=64,
        ge=1,
        description=(
            "Skip images narrower than this many pixels. Page furniture — "
            "rules, bullets, logos — is embedded the same way as content, "
            "and describing or embedding it costs a model call per icon."
        ),
    )
    min_height: int = Field(default=64, ge=1, description="Skip images shorter than this.")


class PdfImageExtractorNode(PipelineNodeBase[PdfImageExtractorConfig]):
    """Extract the images embedded in a PDF as one item each."""

    type = "pdf.images"
    label = "PDF Images"
    category = "ingestion"
    description = "Pull the images embedded in a PDF out as items, one per image."
    example = "SourcePayload(content_type='application/pdf') -> Items(3 images)."
    input_ports = (NodePort(key="source", label="Source", data_type=PortKind.DOCUMENT_SOURCE),)
    output_ports = (
        NodePort(key="items", label="Images", data_type=PortKind.ITEMS, adds=(Facet.IMAGE,)),
    )
    config_model = PdfImageExtractorConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Write each embedded image to storage and emit it as an item."""
        source = SourcePayload.model_validate(inputs.get("source")).source
        if "pdf" not in (source.content_type or "").lower():
            raise InvalidInputError(
                f"PDF image extraction received '{source.content_type or 'unknown'}'. "
                "Wire it to a PDF source."
            )
        path = Path(source.path)
        if not path.exists():
            raise FileNotFoundError(f"PDF file not found: {path}")
        extracted = extracted_pdf_images(
            path, min_width=self.config.min_width, min_height=self.config.min_height
        )
        items = [
            self._store(image, source.document_id, source.metadata, context) for image in extracted
        ]
        return {"items": ItemBatch(items=items)}

    @staticmethod
    def _store(
        image: ExtractedImage,
        document_id: str,
        metadata: DocumentMetadata,
        context: PipelineRunContext,
    ) -> Item:
        """Persist one extracted image and describe it as an item."""
        # Written under derived_dir so the delete/re-ingest purge, which
        # removes exactly that directory, can never miss what this wrote.
        relative = f"{context.storage.derived_dir(context.collection.id, document_id)}/{image.name}"
        context.storage.write_bytes(image.data, relative)
        item_metadata = DocumentMetadata(
            data={**metadata.data, "page": image.page, "image_index": image.index}
        )
        return Item(
            id=f"{document_id}:img:{image.index}",
            image=MediaAsset(
                media_type=image.media_type,
                path=relative,
                byte_size=len(image.data),
                width=image.width,
                height=image.height,
            ),
            document_id=document_id,
            order=image.index,
            metadata=item_metadata,
        )

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        """Summarize the PDF and the images pulled out of it."""
        source = SourcePayload.model_validate(inputs.get("source")).source
        batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[NodeTraceValue(label="Source", value=summarize_source(source))],
            outputs=[NodeTraceValue(label="Images", value=_image_summary(batch))],
        )


def _image_summary(batch: ItemBatch) -> dict[str, object]:
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
