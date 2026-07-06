"""Ingestion pipeline boundary nodes: context-in, result-out."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import IndexingPayload, SourcePayload
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_source
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.base import DocumentSource


class IngestionInputConfig(BaseModel):
    """Configuration for ingestion input nodes."""


class IngestionInputNode(PipelineNodeBase[IngestionInputConfig]):
    """Load a document source from the current ingestion context."""

    type = "ingestion.input"
    label = "Ingestion Input"
    category = "ingestion"
    description = "Build a document source from the uploaded file."
    example = (
        "Context(document='file.pdf') -> "
        "SourcePayload(document_id='123', path='/tmp/file.pdf', "
        "content_type='application/pdf')."
    )
    input_ports = ()
    output_ports = (NodePort(key="source", label="Source", data_type="document_source"),)
    config_model = IngestionInputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Return the DocumentSource for the ingestion run."""
        if context.document is None:
            raise ValueError("Ingestion context is missing a document record.")
        if not context.document.source_path:
            raise ValueError("Document source path is not set for ingestion.")
        metadata = DocumentMetadata(
            data={
                "collection_id": str(context.collection.id),
                "document_id": str(context.document.id),
                "filename": context.document.name,
            }
        )
        source = DocumentSource(
            document_id=str(context.document.id),
            path=Path(context.document.source_path),
            content_type=context.document.content_type,
            metadata=metadata,
        )
        return {"source": SourcePayload(source=source)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the ingestion source payload."""
        payload = SourcePayload.model_validate(outputs.get("source"))
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Source",
                    value=summarize_source(payload.source),
                )
            ]
        )


class IngestionOutputConfig(BaseModel):
    """Configuration for ingestion output nodes."""


class IngestionOutputNode(PipelineNodeBase[IngestionOutputConfig]):
    """Terminal node for ingestion pipelines."""

    type = "ingestion.output"
    label = "Ingestion Output"
    category = "ingestion"
    description = "Emit the indexed chunks for persistence."
    example = "IndexingPayload(chunks=2) -> Result(IndexingPayload(chunks=2))."
    input_ports = (NodePort(key="indexed", label="Indexed", data_type="indexed_batch"),)
    output_ports = (NodePort(key="result", label="Result", data_type="indexed_batch"),)
    config_model = IngestionOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Pass through indexed payloads."""
        payload = IndexingPayload.model_validate(inputs.get("indexed"))
        return {"result": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize ingestion output payloads."""
        payload = IndexingPayload.model_validate(inputs.get("indexed"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={"count": len(payload.chunks)},
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Result",
                    value={"count": len(payload.chunks)},
                )
            ],
        )
