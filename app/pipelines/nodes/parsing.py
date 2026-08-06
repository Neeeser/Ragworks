"""Extract Text: best-effort text from any file the registry answers for."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import ContentTypeClaim
from app.pipelines.nodes.parse_base import ParseNodeBase
from app.pipelines.payloads import Item, ItemBatch
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing.summaries import summarize_text
from app.retrieval.parsers import TEXT_HANDLERS, TextRequest, decode_best_effort


class ParseTextConfig(BaseModel):
    """Configuration for text extraction."""

    encoding: str = Field(
        default="utf-8",
        description="Character encoding used to decode text files.",
    )
    unknown_format: Literal["skip", "plain_text"] = Field(
        default="skip",
        description=(
            "What to do with a file whose content type no text handler "
            "answers for. skip emits nothing and records a warning; "
            "plain_text decodes the bytes with the encoding above, "
            "replacing anything that does not decode."
        ),
    )


class ParseTextNode(ParseNodeBase[ParseTextConfig]):
    """Emit one text item per file, using the handler for its content type."""

    type = "parse.text"
    label = "Extract Text"
    description = "Extract a file's text content as one text item."
    example = "Items(1 file, application/pdf) -> Items(1 text)."
    output_ports = (
        NodePort(key="items", label="Text", data_type=PortKind.ITEMS, adds=(Facet.TEXT,)),
    )
    config_model = ParseTextConfig
    handled_content_types = frozenset(TEXT_HANDLERS)

    @classmethod
    def content_type_claim(cls, config: dict[str, object]) -> ContentTypeClaim:
        """Claim every type when configured to decode unknown formats as text."""
        parsed = ParseTextConfig.model_validate(config or {})
        return ContentTypeClaim(
            types=cls.handled_content_types or frozenset(),
            any_type=parsed.unknown_format == "plain_text",
        )

    def parse_file(
        self, item: Item, path: Path, media_type: str, context: PipelineRunContext
    ) -> list[Item]:
        """Extract the file's text through its registered handler."""
        return self._text_item(item, TEXT_HANDLERS[media_type].extract(self._request(path)))

    def unhandled(self, item: Item, media_type: str, path: Path) -> list[Item]:
        """Decode the bytes anyway, or record that nothing was extracted."""
        if self.config.unknown_format == "plain_text":
            return self._text_item(item, decode_best_effort(self._request(path)))
        return super().unhandled(item, media_type, path)

    def _request(self, path: Path) -> TextRequest:
        """Build the extraction request for this node's configuration."""
        return TextRequest(path=path, encoding=self.config.encoding)

    @staticmethod
    def _text_item(item: Item, text: str) -> list[Item]:
        """Wrap extracted text as one item keyed off the file item.

        The id carries over so chunk ids stay `{document_id}:{n}` — vector
        ids and per-document deletion are keyed on that shape.
        """
        return [
            Item(
                id=item.id,
                text=text,
                document_id=item.document_id,
                order=item.order if item.order is not None else 0,
                metadata=item.metadata.model_copy(deep=True),
            )
        ]

    def output_summary(self, batch: ItemBatch) -> dict[str, object]:
        """Report how much text came out, with a preview of the first item."""
        texts = [item.text for item in batch.items if item.text is not None]
        return {
            "count": len(texts),
            "text": summarize_text(texts[0]).model_dump() if texts else None,
        }
