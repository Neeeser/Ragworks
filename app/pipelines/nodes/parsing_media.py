"""Parse nodes producing image items: embedded media, page renders, media files."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.image_assets import read_image_dimensions, store_derived_image
from app.pipelines.nodes.item_summaries import image_summary
from app.pipelines.nodes.parse_base import ParseNodeBase
from app.pipelines.payloads import Item, ItemBatch, MediaAsset
from app.pipelines.ports import Facet, NodePort, PortKind
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers import (
    EMBEDDED_MEDIA_HANDLERS,
    MEDIA_FILE_TYPES,
    PAGE_IMAGE_HANDLERS,
    EmbeddedMediaRequest,
    ExtractedImage,
    PageImageRequest,
)

IMAGE_OUTPUT_PORT = NodePort(
    key="items", label="Images", data_type=PortKind.ITEMS, adds=(Facet.IMAGE,)
)


class ParseEmbeddedMediaConfig(BaseModel):
    """Configuration for extracting media embedded in container formats."""

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


class ParseEmbeddedMediaNode(ParseNodeBase[ParseEmbeddedMediaConfig]):
    """Pull the media embedded inside a container file out as items."""

    type = "parse.embedded_media"
    label = "Extract Media"
    description = "Pull the images embedded in a document out as items, one per image."
    example = "Items(1 file, application/pdf) -> Items(3 images)."
    output_ports = (IMAGE_OUTPUT_PORT,)
    config_model = ParseEmbeddedMediaConfig
    handled_content_types = frozenset(EMBEDDED_MEDIA_HANDLERS)

    def parse_file(
        self, item: Item, path: Path, media_type: str, context: PipelineRunContext
    ) -> list[Item]:
        """Store each embedded image and emit it as an item."""
        extracted = EMBEDDED_MEDIA_HANDLERS[media_type].extract(
            EmbeddedMediaRequest(
                path=path, min_width=self.config.min_width, min_height=self.config.min_height
            )
        )
        return [
            store_extracted_image(image, item, context, suffix="img") for image in extracted
        ]

    def output_summary(self, batch: ItemBatch) -> dict[str, object]:
        """Describe the extracted images."""
        return image_summary(batch)


class ParsePageImagesConfig(BaseModel):
    """Configuration for rasterizing paginated documents."""

    dpi: int = Field(
        default=150,
        ge=36,
        le=600,
        description=(
            "Resolution each page is rendered at. Higher keeps small type "
            "legible to a vision model and costs proportionally more bytes "
            "per page."
        ),
    )
    max_pages: int | None = Field(
        default=None,
        ge=1,
        description="Render at most this many pages; unset renders the whole document.",
    )


class ParsePageImagesNode(ParseNodeBase[ParsePageImagesConfig]):
    """Render each page of a paginated document as an image item."""

    type = "parse.page_images"
    label = "Render as Images"
    description = "Rasterize a document's pages, one image item per page."
    example = "Items(1 file, application/pdf) -> Items(12 page images)."
    output_ports = (IMAGE_OUTPUT_PORT,)
    config_model = ParsePageImagesConfig
    handled_content_types = frozenset(PAGE_IMAGE_HANDLERS)

    def parse_file(
        self, item: Item, path: Path, media_type: str, context: PipelineRunContext
    ) -> list[Item]:
        """Render every page and store it beside the document's other assets."""
        rendered = PAGE_IMAGE_HANDLERS[media_type].render(
            PageImageRequest(path=path, dpi=self.config.dpi, max_pages=self.config.max_pages)
        )
        return [store_extracted_image(page, item, context, suffix="page") for page in rendered]

    def output_summary(self, batch: ItemBatch) -> dict[str, object]:
        """Describe the rendered pages."""
        return image_summary(batch)


class ParseMediaFileConfig(BaseModel):
    """Configuration for reading a media file as its own content."""


class ParseMediaFileNode(ParseNodeBase[ParseMediaFileConfig]):
    """Emit a file that already is the content as one media item."""

    type = "parse.media_file"
    label = "Media File"
    description = "Read an uploaded image as one item carrying the image."
    example = "Items(1 file, image/png) -> Items(1 image)."
    output_ports = (IMAGE_OUTPUT_PORT,)
    config_model = ParseMediaFileConfig
    handled_content_types = MEDIA_FILE_TYPES

    def parse_file(
        self, item: Item, path: Path, media_type: str, context: PipelineRunContext
    ) -> list[Item]:
        """Emit the uploaded file itself as one image item."""
        asset = item.file
        if asset is None:
            raise ValueError(f"Item '{item.id}' carries no file.")
        width, height = read_image_dimensions(path.read_bytes())
        return [
            Item(
                id=item.id,
                image=MediaAsset(
                    media_type=media_type,
                    path=asset.path,
                    byte_size=asset.byte_size,
                    width=width,
                    height=height,
                ),
                document_id=item.document_id,
                order=item.order if item.order is not None else 0,
                metadata=item.metadata.model_copy(deep=True),
            )
        ]

    def output_summary(self, batch: ItemBatch) -> dict[str, object]:
        """Describe the image the file carried."""
        return image_summary(batch)


def store_extracted_image(
    image: ExtractedImage, item: Item, context: PipelineRunContext, *, suffix: str
) -> Item:
    """Persist one produced image under the document's derived directory."""
    relative = store_derived_image(
        context.storage,
        image.data,
        collection_id=context.collection.id,
        document_id=item.document_id or item.id,
        name=image.name,
    )
    return Item(
        id=f"{item.id}:{suffix}:{image.index}",
        image=MediaAsset(
            media_type=image.media_type,
            path=relative,
            byte_size=len(image.data),
            width=image.width,
            height=image.height,
        ),
        document_id=item.document_id,
        order=image.index,
        metadata=DocumentMetadata(
            data={**item.metadata.data, "page": image.page, "image_index": image.index}
        ),
    )
