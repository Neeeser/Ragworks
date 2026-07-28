"""Pipeline boundary nodes: context-in, result-out for ingestion and retrieval."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.nodes.tool_output import evaluate_output_fields
from app.pipelines.payloads import (
    IndexingPayload,
    Item,
    ItemBatch,
    RetrievalPayload,
    SourcePayload,
    trace_items,
)
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    combine_usage,
    summarize_matches,
    summarize_source,
    summarize_text,
    trace_chunk_items,
    trace_match_items,
)
from app.pipelines.variables import PipelineOutputField
from app.retrieval.models import DocumentMetadata, RetrievalResponse
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
    output_ports = (NodePort(key="source", label="Source", data_type=PortKind.DOCUMENT_SOURCE),)
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

    `items` is variadic: a pipeline may index the same chunks into several
    indexes (dense + BM25) and every indexer wires into this one port. The
    merged result keeps the richest item list (the embedded one, when
    present) and sums usage across branches.
    """

    type = "ingestion.output"
    label = "Ingestion Output"
    category = "ingestion"
    description = "Emit the indexed chunks for persistence."
    example = "Items(2 indexed) -> Result(chunks=2)."
    input_ports = (
        NodePort(
            key="items",
            label="Indexed",
            data_type=PortKind.ITEMS,
            requires=(Facet.TEXT,),
            accepts_many=True,
        ),
    )
    output_ports = (NodePort(key="result", label="Result", data_type=PortKind.RESULT),)
    config_model = IngestionOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Merge indexed item streams from every inbound indexer branch."""
        return {"result": self._merge(inputs)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize ingestion output payloads."""
        batches = self._collect(inputs)
        merged = IndexingPayload.model_validate(outputs.get("result"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label=f"Indexed chunks (branch {index})",
                    value={"count": len(batch.items)},
                )
                for index, batch in enumerate(batches, start=1)
            ]
            + [
                NodeTraceValue(
                    label=f"Indexed items (branch {index})",
                    value=trace_items(batch.items),
                    kind="items",
                )
                for index, batch in enumerate(batches, start=1)
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
        """Merge branch streams: embedded items win, usage sums."""
        batches = cls._collect(inputs)
        # The persisted branch is the one carrying the most embedded items
        # (the dense branch in a hybrid pipeline); ties keep the first, so a
        # single-branch pipeline is a passthrough.
        primary = max(
            batches,
            key=lambda batch: sum(1 for item in batch.items if item.embedding is not None),
        )
        return IndexingPayload(
            chunks=primary.to_chunks(),
            usage=combine_usage([batch.usage for batch in batches]),
        )

    @staticmethod
    def _collect(inputs: dict[str, object]) -> list[ItemBatch]:
        """Validate the variadic `items` input into typed batches.

        The executor always delivers an `accepts_many` port as a list; a bare
        batch is tolerated for direct node-level callers (tests).
        """
        raw = inputs.get("items")
        values = raw if isinstance(raw, list) else [raw]
        return [ItemBatch.model_validate(value) for value in values]


class RetrievalInputConfig(BaseModel):
    """Configuration for query input nodes.

    `arguments` lists the names of input-source variables (declared on
    `PipelineDefinition.variables`) this pipeline accepts from callers — the
    search page renders a control per accepted variable and the chat tool
    schema publishes the `expose_to_llm` ones. The built-in `query` argument
    is implicit and always present. Definition/bounds/default live on the
    variable, never here.

    `tool_name`/`tool_description` are the pipeline's tool identity — the
    base name and description chat and MCP expose (namespaced per collection
    at exposure time). Unset, the identity falls back to the generic search
    projection, which keeps pre-tools pipelines exposing today's
    `search_<collection>` contract unchanged.
    """

    arguments: list[str] = Field(default_factory=list)
    tool_name: str | None = None
    tool_description: str | None = None


class RetrievalInputNode(PipelineNodeBase[RetrievalInputConfig]):
    """Build the query request from the retrieval context."""

    type = "retrieval.input"
    label = "Retrieval Input"
    category = "retrieval"
    description = "Provide the query payload for retrieval."
    example = "Query='coffee' -> Items(text='coffee')."
    input_ports = ()
    output_ports = (
        NodePort(key="items", label="Query", data_type=PortKind.ITEMS, adds=(Facet.TEXT,)),
    )
    config_model = RetrievalInputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Emit the run's query as a single-item stream.

        The fetch depth is node config (retrievers' `top_k`, the Result
        Limit's `max_results`), not part of the data plane; `context.top_k`
        remains the run-level fallback those nodes read.
        """
        if context.query is None:
            raise ValueError("Retrieval context is missing a query string.")
        return {"items": ItemBatch(items=[Item(id="query", text=context.query)])}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the emitted query stream."""
        batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(batch.query_text() or "", 200),
                    kind="text",
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
    example = "Items(matches=2) -> Result(matches=2)."
    input_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            requires=(Facet.TEXT, Facet.SCORE),
        ),
    )
    output_ports = (NodePort(key="result", label="Result", data_type=PortKind.RESULT),)
    config_model = RetrievalOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Build the terminal retrieval result, with declared outputs evaluated."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        payload = RetrievalPayload(
            response=RetrievalResponse(matches=batch.to_matches()),
            usage=batch.usage,
            outputs=self._evaluate_outputs(context),
        )
        return {"result": payload}

    def _evaluate_outputs(
        self, context: PipelineRunContext
    ) -> dict[str, int | float | str | bool]:
        """Evaluate the config's output expressions (shared terminal helper)."""
        return evaluate_output_fields(self.config.outputs, context)

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize retrieval output payloads."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
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
                    value=summarize_matches(input_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Match items",
                    value=trace_items(input_batch.items),
                    kind="items",
                ),
            ],
            outputs=output_values,
        )
