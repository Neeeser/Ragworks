"""Handlers rasterizing paginated documents to one image per page."""

from __future__ import annotations

import io
import logging

import pypdfium2
from PIL import Image

from app.retrieval.parsers.base import PageImageHandler, PageImageRequest
from app.retrieval.parsers.media import FALLBACK_MEDIA_TYPE, ExtractedImage

logger = logging.getLogger(__name__)

#: PDF user-space units per inch — the scale a render DPI is expressed against.
_POINTS_PER_INCH = 72


class PdfPageImageHandler:
    """Render each PDF page to a PNG at the requested resolution."""

    def render(self, request: PageImageRequest) -> list[ExtractedImage]:
        """Return one rendered image per page, in page order.

        A page pdfium cannot rasterize is skipped with a warning: a single
        corrupt page should not cost the rest of the document.
        """
        document = pypdfium2.PdfDocument(str(request.path))
        try:
            count = len(document)
            if request.max_pages is not None:
                count = min(count, request.max_pages)
            pages: list[ExtractedImage] = []
            for index in range(count):
                rendered = self._render_page(document, index, request.dpi)
                if rendered is not None:
                    pages.append(rendered)
            return pages
        finally:
            document.close()

    @staticmethod
    def _render_page(
        document: pypdfium2.PdfDocument, index: int, dpi: int
    ) -> ExtractedImage | None:
        """Rasterize one page, returning None when pdfium cannot read it."""
        page_number = index + 1
        image: Image.Image
        try:
            image = document[index].render(scale=dpi / _POINTS_PER_INCH).to_pil()
        except Exception:  # pdfium raises its own family on malformed pages
            logger.warning("Could not render PDF page %s", page_number)
            return None
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return ExtractedImage(
            name=f"page{page_number}.png",
            data=buffer.getvalue(),
            media_type=FALLBACK_MEDIA_TYPE,
            page=page_number,
            index=index,
            width=image.width,
            height=image.height,
        )


PAGE_IMAGE_HANDLERS: dict[str, PageImageHandler] = {
    "application/pdf": PdfPageImageHandler(),
}
