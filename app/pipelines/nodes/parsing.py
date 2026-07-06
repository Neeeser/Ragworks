"""Document parsing and content-type routing nodes."""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import ParsedDocumentPayload, SourcePayload
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_source, summarize_text
from app.retrieval.parsers.base import DocumentParser
from app.retrieval.parsers.pdf import PdfToTextParser
from app.retrieval.parsers.txt import TxtDocumentParser

logger = logging.getLogger(__name__)


class ParserConfig(BaseModel):
    """Configuration for document parsing."""

    mode: Literal["auto", "pdf", "text"] = "auto"
    encoding: str = "utf-8"


class DocumentParserNode(PipelineNodeBase[ParserConfig]):
    """Parse uploaded documents into normalized text."""

    type = "parser.document"
    label = "Document Parser"
    category = "ingestion"
    description = "Extract text from a document source."
    example = (
        "SourcePayload(content_type='application/pdf') -> "
        "ParsedDocumentPayload(text='Invoice #42 ...')."
    )
    input_ports = (NodePort(key="source", label="Source", data_type="document_source"),)
    output_ports = (NodePort(key="document", label="Document", data_type="document"),)
    config_model = ParserConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Parse a source payload into a document."""
        payload = SourcePayload.model_validate(inputs.get("source"))
        source = payload.source

        parser = self._resolve_parser(source.content_type)
        logger.info(
            "Pipeline parser=%s document_id=%s content_type=%s",
            parser.__class__.__name__,
            source.document_id,
            source.content_type,
        )
        document = parser.parse(source)
        return {"document": ParsedDocumentPayload(document=document)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize document parsing inputs and outputs."""
        source_payload = SourcePayload.model_validate(inputs.get("source"))
        document_payload = ParsedDocumentPayload.model_validate(outputs.get("document"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Source",
                    value=summarize_source(source_payload.source),
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Text",
                    value=summarize_text(document_payload.document.text),
                    kind="text",
                )
            ],
        )

    def _resolve_parser(self, content_type: str | None) -> DocumentParser:
        """Select a parser based on configuration and content type."""
        if self.config.mode == "pdf":
            return PdfToTextParser()
        if self.config.mode == "text":
            return TxtDocumentParser(encoding=self.config.encoding)
        if content_type and "pdf" in content_type:
            return PdfToTextParser()
        return TxtDocumentParser(encoding=self.config.encoding)


class FileTypeRouterConfig(BaseModel):
    """Configuration for file type routing.

    No fields today: routing is purely content-type based (see
    `FileTypeRouterNode.run`), and is not configurable. Previously carried
    `pdf_label`/`text_label`/`other_label` fields that `run()` never read;
    removed as dead code.
    """


class FileTypeRouterNode(PipelineNodeBase[FileTypeRouterConfig]):
    """Route sources based on content type."""

    type = "router.file_type"
    label = "File Type Router"
    category = "ingestion"
    description = "Branch the pipeline based on the file content type."
    example = "SourcePayload(content_type='application/pdf') -> {pdf: SourcePayload(...)}."
    input_ports = (NodePort(key="source", label="Source", data_type="document_source"),)
    output_ports = (
        NodePort(key="pdf", label="PDF", data_type="document_source", required=False),
        NodePort(key="text", label="Text", data_type="document_source", required=False),
        NodePort(key="other", label="Other", data_type="document_source", required=False),
    )
    config_model = FileTypeRouterConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Return the source on the appropriate output port."""
        payload = SourcePayload.model_validate(inputs.get("source"))
        source = payload.source
        content_type = (source.content_type or "").lower()
        if "pdf" in content_type:
            return {"pdf": payload}
        if "text" in content_type or "plain" in content_type:
            return {"text": payload}
        return {"other": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize how the document was routed."""
        source_payload = SourcePayload.model_validate(inputs.get("source"))
        route = next(iter(outputs.keys()), "unknown")
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Source",
                    value=summarize_source(source_payload.source),
                )
            ],
            outputs=[NodeTraceValue(label="Route", value=route)],
        )
