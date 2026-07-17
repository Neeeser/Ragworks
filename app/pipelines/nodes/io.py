"""Pipeline boundary nodes: context-in, result-out for ingestion and retrieval."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.expressions import ExpressionError, ModelValue, evaluate, parse
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
    trace_chunk_items,
    trace_match_items,
)
from app.pipelines.variables import PipelineInputArgument, PipelineOutputField
from app.retrieval.models import DocumentMetadata, QueryRequest
from app.retrieval.parsers.base import DocumentSource
from app.services.files import FileSystemService


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
        display_path = context.document.name
        if context.document.file_id:
            file_service = FileSystemService(context.session)
            file_node = file_service.nodes.get(context.document.file_id)
            if file_node:
                display_path = file_service.read_node(file_node).path
        metadata = DocumentMetadata(
            data={
                "collection_id": str(context.collection.id),
                "document_id": str(context.document.id),
                "filename": context.document.name,
                "path": display_path,
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
            ]
            + [
                NodeTraceValue(
                    label=f"Indexed items (branch {index})",
                    value=trace_chunk_items(payload.chunks),
                    kind="items",
                )
                for index, payload in enumerate(payloads, start=1)
            ],
            outputs=[
                NodeTraceValue(
                    label="Result",
                    value={"count": len(merged.chunks)},
                ),
                NodeTraceValue(
                    label="Result items",
                    value=trace_chunk_items(merged.chunks),
                    kind="items",
                ),
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
    """Configuration for retrieval input nodes.

    `arguments` declares the caller-supplied inputs this pipeline accepts —
    the search page renders a control per entry and the chat tool schema
    publishes the `expose_to_llm` ones. The built-in `query` argument is
    implicit and always present.
    """

    arguments: list[PipelineInputArgument] = Field(default_factory=list)


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
        """Create a QueryRequest from context.

        A declared `top_k` argument (or variable) takes precedence over the
        legacy `context.top_k`; pipelines declaring nothing keep the old
        `context.top_k or 5` behavior byte for byte.
        """
        if context.query is None:
            raise ValueError("Retrieval context is missing a query string.")
        top_k = self._resolve_top_k(context)
        request = QueryRequest(
            text=context.query,
            top_k=top_k,
            namespace=None,
        )
        return {"request": RetrievalRequestPayload(request=request)}

    @staticmethod
    def _resolve_top_k(context: PipelineRunContext) -> int:
        """Return the effective request depth for this run."""
        if context.variables is not None:
            declared = context.variables.values.get("top_k")
            if isinstance(declared, int) and not isinstance(declared, bool):
                return declared
        return context.top_k or 5

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
    """Configuration for retrieval output nodes.

    `outputs` declares extra named expressions evaluated against the run's
    variable environment and returned beside the results (e.g. the effective
    over-retrieval depth). Purely additive: an empty list is today's behavior.
    """

    outputs: list[PipelineOutputField] = Field(default_factory=list)


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
        """Return the retrieval payload, with declared outputs evaluated."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        outputs = self._evaluate_outputs(context)
        if outputs:
            payload = payload.model_copy(update={"outputs": outputs})
        return {"result": payload}

    def _evaluate_outputs(
        self, context: PipelineRunContext
    ) -> dict[str, int | float | str | bool]:
        """Evaluate the config's output expressions against the run environment.

        Validation checks these statically; a failure here (or a bare model
        value, which has no scalar wire shape) is an honest run error.
        """
        if not self.config.outputs or context.variables is None:
            return {}
        results: dict[str, int | float | str | bool] = {}
        for output in self.config.outputs:
            try:
                value = evaluate(parse(output.expression), context.variables.values)
            except ExpressionError as error:
                raise ValueError(f"Output '{output.name}': {error.message}") from error
            if isinstance(value, ModelValue):
                raise ValueError(
                    f"Output '{output.name}': dereference the model variable with "
                    ".connection_id or .model_name."
                )
            results[output.name] = value
        return results

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize retrieval output payloads."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        result_payload = RetrievalPayload.model_validate(outputs.get("result"))
        output_values = [
            NodeTraceValue(
                label="Result",
                value=summarize_matches(result_payload.response.matches),
            ),
            NodeTraceValue(
                label="Result items",
                value=trace_match_items(result_payload.response.matches),
                kind="items",
            ),
        ]
        if result_payload.outputs:
            output_values.append(
                NodeTraceValue(label="Outputs", value=dict(result_payload.outputs))
            )
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Matches",
                    value=summarize_matches(payload.response.matches),
                ),
                NodeTraceValue(
                    label="Match items",
                    value=trace_match_items(payload.response.matches),
                    kind="items",
                ),
            ],
            outputs=output_values,
        )
