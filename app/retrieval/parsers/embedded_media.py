"""Handlers pulling the media embedded inside container formats."""

from __future__ import annotations

import logging

from pypdf import PdfReader

from app.retrieval.parsers.base import EmbeddedMediaHandler, EmbeddedMediaRequest
from app.retrieval.parsers.media import ExtractedImage, media_type_suffix, normalize_image

logger = logging.getLogger(__name__)


class PdfEmbeddedImageHandler:
    """Extract the images embedded in a PDF, above a size floor."""

    def extract(self, request: EmbeddedMediaRequest) -> list[ExtractedImage]:
        """Return the PDF's embedded images above the size floor, in page order.

        A page whose images cannot be decoded is skipped with a warning
        rather than failing the document: one malformed XObject in a
        hundred-page report should not cost the other ninety-nine pages.
        """
        reader = PdfReader(str(request.path))
        images: list[ExtractedImage] = []
        for page_number, page in enumerate(reader.pages, start=1):
            try:
                page_images = list(page.images)
            except Exception:  # pypdf raises a wide family on malformed streams
                logger.warning("Could not read images from PDF page %s", page_number)
                continue
            for embedded in page_images:
                normalized = normalize_image(embedded.data)
                if normalized is None:
                    continue
                data, media_type, width, height = normalized
                if width < request.min_width or height < request.min_height:
                    continue
                index = len(images)
                images.append(
                    ExtractedImage(
                        name=f"page{page_number}-{index}{media_type_suffix(media_type)}",
                        data=data,
                        media_type=media_type,
                        page=page_number,
                        index=index,
                        width=width,
                        height=height,
                    )
                )
        return images


EMBEDDED_MEDIA_HANDLERS: dict[str, EmbeddedMediaHandler] = {
    "application/pdf": PdfEmbeddedImageHandler(),
}
