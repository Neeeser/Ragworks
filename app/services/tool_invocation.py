"""Run a collection tool binding: the single pipeline-invocation path.

Every caller-facing query runs through here — the legacy collection query API
(`RetrievalService` adapts it), the per-tool invoke endpoint, and chat tool
calls. It owns the run lifecycle around `PipelineRunner` (argument
validation, failure shaping with a trace link, query-event persistence,
telemetry) so no surface hand-rolls a second copy.
"""

from __future__ import annotations

from collections.abc import Mapping
from time import perf_counter
from uuid import UUID

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import QueryRepository
from app.pipelines.execution.runner import PipelineRunHandle, PipelineRunner
from app.pipelines.interface import ToolOutputKind
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.resolution import VariableResolutionError
from app.pipelines.tracing.summaries import TokenUsage
from app.providers.registry import ProviderResolver
from app.schemas.retrieval import (
    FailedNodeRef,
    RetrievalFailureDetail,
    RetrievedChunk,
)
from app.schemas.tools import ToolInvocationResponse
from app.services.errors import (
    InvalidInputError,
    InvalidQueryArgumentsError,
    ServiceError,
    is_external_provider_error,
)
from app.services.pipeline_resolution import ResolvedPipeline, resolve_tool_binding
from app.telemetry import record
from app.telemetry.events import RetrievalQueryRan
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider

DEFAULT_TOP_K = 5


class RetrievalPipelineError(ServiceError):
    """A tool run failed; `.detail` is a `RetrievalFailureDetail` dict.

    The HTTP status is pinned at the raise site (502 for an upstream provider
    fault, 500 for an internal bug), but both carry the structured detail so
    the frontend can always link the run trace.
    """


class ToolInvocationService:
    """Run a resolved tool binding and shape its discriminated result."""

    def __init__(self, session: Session) -> None:
        """Initialize invocation dependencies."""
        self.settings = get_settings()
        self.session = session

    def invoke_binding(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        user: models.User,
        collection: models.Collection,
        binding_id: UUID,
        query: str,
        top_k: int | None = None,
        arguments: Mapping[str, object] | None = None,
    ) -> ToolInvocationResponse:
        """Resolve one tool binding by id and invoke it."""
        resolved = resolve_tool_binding(self.session, user, collection, binding_id)
        return self.invoke(
            user, collection, resolved, query, top_k=top_k, arguments=arguments
        )

    def invoke(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        user: models.User,
        collection: models.Collection,
        resolved: ResolvedPipeline,
        query: str,
        top_k: int | None = None,
        arguments: Mapping[str, object] | None = None,
    ) -> ToolInvocationResponse:
        """Run a resolved tool binding and return its result.

        `arguments` are the caller-supplied values for the pipeline's declared
        input arguments; invalid values are an `InvalidInputError` (400).
        """
        start_time = perf_counter()
        runner = PipelineRunner(self.session)
        try:
            handle = self._start_run(runner, resolved, user, collection, query, top_k, arguments)
        except VariableResolutionError as exc:
            raise InvalidQueryArgumentsError(str(exc)) from exc
        try:
            result = runner.execute(handle)
            payload = self._extract_payload(result.terminal_outputs)
            requested = top_k if top_k is not None else DEFAULT_TOP_K
            effective_top_k = (
                handle.context.top_k if handle.context.top_k is not None else requested
            )
            return self._record_and_respond(
                user=user,
                collection=collection,
                query=query,
                top_k=effective_top_k,
                arguments=arguments,
                resolved=resolved,
                payload=payload,
                handle=handle,
                start_time=start_time,
            )
        except Exception as exc:
            handle.trace.mark_run_failed(exc)
            raise self._build_failure(handle, exc) from exc

    def _build_failure(self, handle: PipelineRunHandle, exc: Exception) -> RetrievalPipelineError:
        """Build the structured, trace-linked error for a failed tool run.

        Reads the FAILED node from the in-memory trace recorder -- never a DB
        query, because a mid-run DB error (e.g. a vector-dimension mismatch)
        aborts the transaction and any post-failure SELECT would raise. Derives
        a readable message that names the node and pins the status: 502 for an
        upstream provider fault, 500 for an internal bug. The raw provider text
        stays in the trace, never the primary message.
        """
        failed_node_run = handle.trace.failed_node_run
        failed_node = (
            FailedNodeRef(
                node_id=failed_node_run.node_id,
                node_name=failed_node_run.node_name,
                node_type=failed_node_run.node_type,
            )
            if failed_node_run
            else None
        )
        external = is_external_provider_error(exc)
        where = f" at {failed_node.node_name}" if failed_node else ""
        message = (
            f"Retrieval failed{where}: the model provider returned an error. "
            "Open the run trace for the provider's full message."
            if external
            else f"Retrieval failed{where} due to an internal error. See the run trace for details."
        )
        detail = RetrievalFailureDetail(
            message=message,
            code="retrieval_pipeline_failed",
            failed_node=failed_node,
            pipeline_run_id=handle.run.id,
        )
        return RetrievalPipelineError(
            detail.model_dump(mode="json"),
            status_code=502 if external else 500,
        )

    # pylint: disable-next=too-many-arguments
    def _record_and_respond(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int,
        arguments: Mapping[str, object] | None,
        resolved: ResolvedPipeline,
        payload: RetrievalPayload,
        handle: PipelineRunHandle,
        start_time: float,
    ) -> ToolInvocationResponse:
        """Persist the query event, record telemetry, and shape the response."""
        latency_ms = (perf_counter() - start_time) * 1000
        event = self._record_query_event(
            user=user,
            collection=collection,
            query=query,
            top_k=top_k,
            arguments=arguments,
            resolved=resolved,
            payload=payload,
            handle=handle,
            latency_ms=latency_ms,
        )
        record(
            RetrievalQueryRan(
                user_id=user.id,
                collection_id=collection.id,
                latency_ms=latency_ms,
                top_k=top_k,
                index_backend=resolved.settings.backend.value,
            )
        )
        kind = resolved.interface.output_kind or ToolOutputKind.CHUNKS
        return ToolInvocationResponse(
            kind="structured" if kind is ToolOutputKind.STRUCTURED else "chunks",
            tool_binding_id=resolved.binding.id,
            query=query,
            top_k=top_k,
            chunks=self._map_chunks(payload),
            outputs=dict(payload.outputs),
            usage=payload.usage.model_dump(),
            query_event_id=event.id,
            pipeline_run_id=handle.run.id,
        )

    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _start_run(
        self,
        runner: PipelineRunner,
        resolved: ResolvedPipeline,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int | None,
        arguments: Mapping[str, object] | None = None,
    ) -> PipelineRunHandle:
        """Resolve provider clients and start the tool pipeline run."""
        providers = ProviderResolver(user, self.session)
        vector_stores = VectorStoreProvider(user, self.session)
        version = resolved.service.get_current_version(resolved.pipeline)
        return runner.start(
            pipeline=resolved.pipeline,
            version=version,
            definition=resolved.definition,
            trigger=models.BindingRole.TOOL,
            user=user,
            collection=collection,
            settings=self.settings,
            providers=providers,
            vector_stores=vector_stores,
            storage=FileStorage(),
            query=query,
            top_k=top_k if top_k is not None else DEFAULT_TOP_K,
            arguments=arguments,
        )

    @staticmethod
    def _map_chunks(payload: RetrievalPayload) -> list[RetrievedChunk]:
        """Map scored retrieval matches onto the wire chunk shape."""
        return [
            RetrievedChunk(
                chunk_id=scored.chunk.chunk_id,
                document_id=scored.chunk.document_id,
                score=scored.score,
                text=scored.chunk.text,
                metadata=scored.chunk.metadata.data,
            )
            for scored in payload.response.matches
        ]

    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _record_query_event(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int,
        arguments: Mapping[str, object] | None,
        resolved: ResolvedPipeline,
        payload: RetrievalPayload,
        handle: PipelineRunHandle,
        latency_ms: float,
    ) -> models.QueryEvent:
        """Persist a `QueryEvent` recording this run's outcome and usage."""
        matches = payload.response.matches
        usage = payload.usage.model_dump()
        response_payload: dict[str, object] = {
            "match_count": len(matches),
            "max_score": max((match.score for match in matches), default=0.0),
            "min_score": min((match.score for match in matches), default=0.0),
            "pipeline_id": str(resolved.pipeline.id),
            "usage": usage,
        }
        if arguments:
            response_payload["arguments"] = dict(arguments)
        if payload.outputs:
            response_payload["outputs"] = dict(payload.outputs)
        return QueryRepository(self.session).add_event(
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text=query,
                top_k=top_k,
                model=resolved.settings.embedding_model,
                context_tokens=self._context_tokens(payload.usage),
                latency_ms=latency_ms,
                response_payload=response_payload,
                pipeline_run_id=handle.run.id,
            )
        )

    @staticmethod
    def _context_tokens(usage: TokenUsage) -> int:
        """Return the token count to record for a query, preferring the total."""
        return usage.total_tokens or usage.prompt_tokens or 0

    @staticmethod
    def _extract_payload(
        terminal_outputs: dict[str, dict[str, object]],
    ) -> RetrievalPayload:
        """Return the tool result payload from terminal outputs."""
        for outputs in terminal_outputs.values():
            if "result" in outputs:
                return RetrievalPayload.model_validate(outputs["result"])
        raise InvalidInputError("Pipeline did not return a retrieval result payload.")
