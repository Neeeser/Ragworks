"""Service for resolving pipeline execution traces.

`TraceService` is the one place that turns a `PipelineRun` row (looked up by
run id, document id, or query event id) into the full `PipelineTraceResponse`
the trace API returns. It raises `TraceNotFoundError` (a `ValueError`) for
every "not found" case -- ownership checks, missing runs, and missing
definitions alike -- so the routes stay thin: catch it once, translate to 404.
"""

from __future__ import annotations

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


class TraceNotFoundError(ValueError):
    """Raised when a requested trace, document, or query event cannot be found."""


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
        focused_item = self._resolve_focused_item(chunk_id, user_id) if chunk_id else None
        return DocumentTraceResponse(trace=trace, focused_item=focused_item)

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

        `chunk_id` identifies which retrieved chunk to trace back (chunk ids
        are `{document_id}:{index}`). The origin side is best-effort: a
        missing/foreign document, a chunk id in an unexpected format, or a
        document without a recorded ingestion run degrade to `origin=None`
        rather than failing the retrieval trace.
        """
        retrieval = self.get_query_event_trace(query_event_id, user_id)
        origin = self._resolve_origin(chunk_id, user_id) if chunk_id else None
        focused_item = self._resolve_focused_item(chunk_id, user_id) if chunk_id else None
        return EndToEndTraceResponse(
            retrieval=retrieval, origin=origin, focused_item=focused_item
        )

    def _resolve_focused_item(self, chunk_id: str, user_id: UUID) -> FocusedItemRead:
        """Resolve a focused chunk id to its stored text and document context.

        Always returns a payload: an id that no longer maps to a stored chunk
        (deleted or re-ingested content, or an unexpected format) comes back
        with `status="missing"` so the trace UI can say "text unavailable"
        instead of failing the trace.
        """
        missing = FocusedItemRead(id=chunk_id, status="missing")
        document_id_part, _, index_part = chunk_id.partition(":")
        try:
            document_id = UUID(document_id_part)
            chunk_index = int(index_part)
        except ValueError:
            return missing
        document = self._documents.get_for_user(document_id, user_id)
        if not document:
            return missing
        chunk = self._chunks.get_by_index(document.id, chunk_index)
        if not chunk:
            return missing
        return FocusedItemRead(
            id=chunk_id,
            status="resolved",
            text=chunk.text,
            document_id=document.id,
            filename=document.name,
            chunk_index=chunk.chunk_index,
            chunk_count=document.num_chunks,
        )

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

    def _resolve_definition(self, run: models.PipelineRun) -> PipelineDefinition:
        """Resolve the pipeline definition a run executed against."""
        if run.pipeline_version_id:
            version = self._versions.get_by_id(run.pipeline_version_id)
            if version:
                return PipelineDefinition.model_validate(version.definition)
        pipeline = self._pipelines.get(run.pipeline_id)
        if not pipeline:
            raise TraceNotFoundError("Pipeline not found.")
        return PipelineService(self._session).get_definition(pipeline)

    def _build_trace_response(self, run: models.PipelineRun) -> PipelineTraceResponse:
        """Build the trace response payload for a pipeline run."""
        node_runs = self._runs.list_node_runs(run.id)
        node_io = self._runs.list_node_io(run.id)
        definition = self._resolve_definition(run)
        return PipelineTraceResponse(
            run=PipelineRunRead.model_validate(run),
            definition=definition,
            node_runs=[
                PipelineNodeRunRead.model_validate(node_run) for node_run in node_runs
            ],
            node_io=[PipelineNodeIORead.model_validate(io_record) for io_record in node_io],
        )
