"""Service for resolving pipeline execution traces.

`TraceService` is the one place that turns a `PipelineRun` row (looked up by
run id, document id, or query event id) into the full `PipelineTraceResponse`
the trace API returns. It raises `TraceNotFoundError` (a `ValueError`) for
every "not found" case -- ownership checks, missing runs, and missing
definitions alike -- so the routes stay thin: catch it once, translate to 404.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    ChunkRepository,
    DocumentRepository,
    PipelineRepository,
    PipelineRunRepository,
    PipelineVersionRepository,
    QueryRepository,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.tracing.summaries import ItemListTrace
from app.schemas.traces import (
    DocumentTraceResponse,
    EndToEndTraceResponse,
    FocusedItemRead,
    PipelineNodeIORead,
    PipelineNodeRunRead,
    PipelineRunRead,
    PipelineTraceResponse,
    TraceOriginRead,
)
from app.services.pipelines import PipelineService
from app.services.trace_topology import covers_recorded_nodes, reconstruct_definition


class TraceNotFoundError(ValueError):
    """Raised when a requested trace, document, or query event cannot be found."""


def chunk_position(item_id: str) -> tuple[UUID, int] | None:
    """Resolve a stream item's id to the stored chunk position it names.

    Ids are `{document}`, `{document}:{index}`, or a kind-marked form such as
    `{document}:img:{index}` — each parse node names its items in whichever
    shape fits what it produced, while the store keys every chunk by
    `(document, index)` regardless. So the index is the trailing segment, and
    an id carrying none is a document that became a single chunk (a standalone
    image), which is index 0.

    `None` for anything whose first segment is not a document id.
    """
    document_part, _, remainder = item_id.partition(":")
    try:
        document_id = UUID(document_part)
    except ValueError:
        return None
    if not remainder:
        return (document_id, 0)
    try:
        return (document_id, int(remainder.rsplit(":", 1)[-1]))
    except ValueError:
        return None


class TraceService:
    """Resolves pipeline run traces for the trace API."""

    def __init__(self, session: Session) -> None:
        """Initialize the service with a session and its repositories."""
        self._session = session
        self._runs = PipelineRunRepository(session)
        self._pipelines = PipelineRepository(session)
        self._versions = PipelineVersionRepository(session)
        self._documents = DocumentRepository(session)
        self._chunks = ChunkRepository(session)
        self._queries = QueryRepository(session)

    def get_run_trace(self, run_id: UUID, user_id: UUID) -> PipelineTraceResponse:
        """Return the trace for a pipeline run owned by the user."""
        run = self._runs.get(run_id, user_id=user_id)
        if not run:
            raise TraceNotFoundError("Trace not found.")
        return self._build_trace_response(run)

    def get_document_trace(self, document_id: UUID, user_id: UUID) -> PipelineTraceResponse:
        """Return the ingestion trace for a document owned by the user."""
        document = self._documents.get_for_user(document_id, user_id)
        if not document:
            raise TraceNotFoundError("Document not found.")
        if not document.ingestion_run_id:
            raise TraceNotFoundError("Trace not found.")
        return self.get_run_trace(document.ingestion_run_id, user_id)

    def get_document_focused_trace(
        self,
        document_id: UUID,
        user_id: UUID,
        chunk_id: str | None = None,
    ) -> DocumentTraceResponse:
        """Return the ingestion trace with one chunk resolved for focus."""
        trace = self.get_document_trace(document_id, user_id)
        if not chunk_id:
            return DocumentTraceResponse(trace=trace)
        focused_item, context_items = self._resolve_focused_context(chunk_id, [trace], user_id)
        return DocumentTraceResponse(
            trace=trace,
            focused_item=focused_item,
            context_items=context_items,
        )

    def get_query_event_trace(self, query_event_id: UUID, user_id: UUID) -> PipelineTraceResponse:
        """Return the retrieval trace for a query event owned by the user."""
        event = self._queries.get_for_user(query_event_id, user_id)
        if not event:
            raise TraceNotFoundError("Query event not found.")
        if not event.pipeline_run_id:
            raise TraceNotFoundError("Trace not found.")
        return self.get_run_trace(event.pipeline_run_id, user_id)

    def get_query_event_end_to_end_trace(
        self,
        query_event_id: UUID,
        user_id: UUID,
        chunk_id: str | None = None,
    ) -> EndToEndTraceResponse:
        """Return the retrieval trace joined with the chunk's ingestion trace.

        `chunk_id` identifies which retrieved chunk to trace back (see
        `chunk_position` for the id shapes). The origin side is best-effort: a
        missing/foreign document, a chunk id in an unexpected format, or a
        document without a recorded ingestion run degrade to `origin=None`
        rather than failing the retrieval trace.
        """
        retrieval = self.get_query_event_trace(query_event_id, user_id)
        origin = self._resolve_origin(chunk_id, user_id) if chunk_id else None
        focused_item = None
        context_items: list[FocusedItemRead] = []
        if chunk_id:
            traces = [retrieval]
            if origin:
                traces.append(origin.trace)
            focused_item, context_items = self._resolve_focused_context(chunk_id, traces, user_id)
        return EndToEndTraceResponse(
            retrieval=retrieval,
            origin=origin,
            focused_item=focused_item,
            context_items=context_items,
        )

    def _resolve_focused_context(
        self,
        focused_id: str,
        traces: list[PipelineTraceResponse],
        user_id: UUID,
    ) -> tuple[FocusedItemRead, list[FocusedItemRead]]:
        """Resolve focus plus every recorded ±2 neighbor in one batch lookup."""
        context_ids = self._context_item_ids(traces, focused_id)
        requested_ids = list(dict.fromkeys([focused_id, *context_ids]))
        positions: dict[str, tuple[UUID, int]] = {}
        for item_id in requested_ids:
            position = chunk_position(item_id)
            if position is not None:
                positions[item_id] = position

        stored = self._chunks.list_context_by_positions_for_user(positions.values(), user_id)
        stored_by_position = {(item.document_id, item.chunk_index): item for item in stored}

        def build_item(item_id: str) -> FocusedItemRead:
            position = positions.get(item_id)
            record = stored_by_position.get(position) if position else None
            if not record:
                return FocusedItemRead(id=item_id, status="missing")
            return FocusedItemRead(
                id=item_id,
                status="resolved",
                text=record.text,
                document_id=record.document_id,
                filename=record.filename,
                chunk_index=record.chunk_index,
                chunk_count=record.chunk_count,
            )

        return build_item(focused_id), [build_item(item_id) for item_id in context_ids]

    @staticmethod
    def _context_item_ids(traces: list[PipelineTraceResponse], focused_id: str) -> list[str]:
        """Collect deduplicated ±2 neighbors around focus in recorded list order."""
        context_ids: dict[str, None] = {}
        for trace in traces:
            for node_run in trace.node_runs:
                values = [*node_run.summary.inputs, *node_run.summary.outputs]
                for value in values:
                    if value.kind != "items":
                        continue
                    item_list = ItemListTrace.model_validate(value.value)
                    ids = [item.id for item in item_list.items]
                    for focus_index, item_id in enumerate(ids):
                        if item_id != focused_id:
                            continue
                        start = max(0, focus_index - 2)
                        stop = focus_index + 3
                        for neighbor_id in ids[start:stop]:
                            context_ids.setdefault(neighbor_id, None)
        return list(context_ids)

    def _resolve_origin(self, chunk_id: str, user_id: UUID) -> TraceOriginRead | None:
        """Resolve a chunk id back to its document's ingestion trace."""
        try:
            document_id = UUID(chunk_id.split(":", 1)[0])
        except ValueError:
            return None
        document = self._documents.get_for_user(document_id, user_id)
        if not document or not document.ingestion_run_id:
            return None
        try:
            trace = self.get_run_trace(document.ingestion_run_id, user_id)
        except TraceNotFoundError:
            return None
        return TraceOriginRead(
            document_id=document.id,
            document_name=document.name,
            chunk_id=chunk_id,
            trace=trace,
        )

    def _resolve_definition(
        self,
        run: models.PipelineRun,
        node_runs: Sequence[models.PipelineNodeRun],
        node_io: Sequence[models.PipelineNodeIO],
    ) -> PipelineDefinition:
        """Resolve the graph the run executed, falling back to what it recorded.

        The recorded version is authoritative. When it is gone -- runs from
        before `pipeline_version_id` existed, or a deleted version row -- the
        pipeline's current definition is a *different* graph whose node ids
        match nothing the run recorded, so the trace canvas would render
        empty. Reconstruct from the run's own recorded rows instead, and hold
        the same invariant when a resolved definition turns out not to contain
        every recorded node. A run that recorded nodes but whose pipeline row
        is also gone still traces: the run's rows are enough on their own.
        """
        candidate = self._resolve_stored_definition(run)
        if candidate is not None and covers_recorded_nodes(candidate, node_runs):
            return candidate
        if not node_runs:
            if candidate is None:
                raise TraceNotFoundError("Pipeline not found.")
            return candidate
        return reconstruct_definition(node_runs, node_io)

    def _resolve_stored_definition(self, run: models.PipelineRun) -> PipelineDefinition | None:
        """Return the stored definition for the run's version, else the pipeline's."""
        if run.pipeline_version_id:
            version = self._versions.get_by_id(run.pipeline_version_id)
            if version:
                return PipelineDefinition.model_validate(version.definition)
        pipeline = self._pipelines.get(run.pipeline_id)
        if not pipeline:
            return None
        return PipelineService(self._session).get_definition(pipeline)

    def _build_trace_response(self, run: models.PipelineRun) -> PipelineTraceResponse:
        """Build the trace response payload for a pipeline run."""
        node_runs = self._runs.list_node_runs(run.id)
        node_io = self._runs.list_node_io(run.id)
        definition = self._resolve_definition(run, node_runs, node_io)
        return PipelineTraceResponse(
            run=PipelineRunRead.model_validate(run),
            definition=definition,
            node_runs=[PipelineNodeRunRead.model_validate(node_run) for node_run in node_runs],
            node_io=[PipelineNodeIORead.model_validate(io_record) for io_record in node_io],
        )
