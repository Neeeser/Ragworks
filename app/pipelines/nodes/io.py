"""Pipeline boundary nodes: context-in, result-out for ingestion and retrieval."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import (
    IndexingPayload,
    RetrievalPayload,
    RetrievalRequestPayload,
    SourcePayload,
)
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    combine_usage,
    summarize_matches,
    summarize_source,
    summarize_text,
)
from app.retrieval.models import DocumentMetadata, QueryRequest
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
    """Terminal node for ingestion pipelines.

    `indexed` is variadic: a pipeline may index the same chunks into several
    indexes (dense + BM25) and every indexer wires into this one port. The
    merged result keeps the richest chunk list (the embedded one, when
    present) and sums usage across branches.
    """

    type = "ingestion.output"
    label = "Ingestion Output"
    category = "ingestion"
    description = "Emit the indexed chunks for persistence."
    example = "IndexingPayload(chunks=2) -> Result(IndexingPayload(chunks=2))."
    input_ports = (
        NodePort(key="indexed", label="Indexed", data_type="indexed_batch", accepts_many=True),
    )
    output_ports = (NodePort(key="result", label="Result", data_type="indexed_batch"),)
    config_model = IngestionOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Merge indexed payloads from every inbound indexer branch."""
        return {"result": self._merge(inputs)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize ingestion output payloads."""
        payloads = self._collect(inputs)
        merged = IndexingPayload.model_validate(outputs.get("result"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label=f"Indexed chunks (branch {index})",
                    value={"count": len(payload.chunks)},
                )
                for index, payload in enumerate(payloads, start=1)
            ],
            outputs=[
                NodeTraceValue(
                    label="Result",
                    value={"count": len(merged.chunks)},
                )
            ],
        )

    @classmethod
    def _merge(cls, inputs: dict[str, object]) -> IndexingPayload:
        """Merge branch payloads: embedded chunks win, usage sums."""
        payloads = cls._collect(inputs)
        # The persisted branch is the one carrying the most embedded chunks
        # (the dense branch in a hybrid pipeline); ties keep the first, so a
        # single-branch pipeline is a passthrough.
        primary = max(
            payloads,
            key=lambda payload: sum(
                1 for chunk in payload.chunks if chunk.embedding is not None
            ),
        )
        return IndexingPayload(
            document=primary.document,
            chunks=primary.chunks,
            usage=combine_usage([payload.usage for payload in payloads]),
        )

    @staticmethod
    def _collect(inputs: dict[str, object]) -> list[IndexingPayload]:
        """Validate the variadic `indexed` input into typed payloads.

        The executor always delivers an `accepts_many` port as a list; a bare
        payload is tolerated for direct node-level callers (tests).
        """
        raw = inputs.get("indexed")
        items = raw if isinstance(raw, list) else [raw]
        return [IndexingPayload.model_validate(item) for item in items]


class RetrievalInputConfig(BaseModel):
    """Configuration for retrieval input nodes."""


class RetrievalInputNode(PipelineNodeBase[RetrievalInputConfig]):
    """Build the query request from the retrieval context."""

    type = "retrieval.input"
    label = "Retrieval Input"
    category = "retrieval"
    description = "Provide the query payload for retrieval."
    example = "Query='coffee', top_k=3 -> QueryRequest(text='coffee', top_k=3)."
    input_ports = ()
    output_ports = (NodePort(key="request", label="Request", data_type="query_request"),)
    config_model = RetrievalInputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Create a QueryRequest from context."""
        if context.query is None:
            raise ValueError("Retrieval context is missing a query string.")
        top_k = context.top_k or 5
        request = QueryRequest(
            text=context.query,
            top_k=top_k,
            namespace=None,
        )
        return {"request": RetrievalRequestPayload(request=request)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the query request inputs and outputs."""
        payload = RetrievalRequestPayload.model_validate(outputs.get("request"))
        request = payload.request
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(request.text, 200),
                    kind="text",
                ),
                NodeTraceValue(
                    label="Top K",
                    value=request.top_k,
                ),
            ]
        )


class RetrievalOutputConfig(BaseModel):
    """Configuration for retrieval output nodes."""


class RetrievalOutputNode(PipelineNodeBase[RetrievalOutputConfig]):
    """Terminal node for retrieval pipelines."""

    type = "retrieval.output"
    label = "Retrieval Output"
    category = "retrieval"
    description = "Emit retrieval results for the API."
    example = "RetrievalPayload(matches=2) -> Result(RetrievalPayload(matches=2))."
    input_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    output_ports = (NodePort(key="result", label="Result", data_type="retrieval_results"),)
    config_model = RetrievalOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Return the retrieval payload."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        return {"result": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize retrieval output payloads."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Matches",
                    value=summarize_matches(payload.response.matches),
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Result",
                    value=summarize_matches(payload.response.matches),
                )
            ],
        )
