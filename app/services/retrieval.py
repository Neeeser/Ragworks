"""Retrieval service for collection queries."""

# pylint: disable=duplicate-code

from __future__ import annotations

from time import perf_counter

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import QueryRepository
from app.pipelines.execution.runner import PipelineRunHandle, PipelineRunner
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.tracing.summaries import TokenUsage
from app.providers.registry import ProviderResolver
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk
from app.services.errors import ExternalServiceError, InvalidInputError, is_external_provider_error
from app.services.pipeline_resolution import ResolvedRetrievalPipeline, resolve_retrieval_pipeline
from app.telemetry import record
from app.telemetry.events import RetrievalQueryRan
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider


class RetrievalService:  # pylint: disable=too-few-public-methods
    """Service for querying a collection's vector index."""

    def __init__(self, session: Session) -> None:
        """Initialize retrieval dependencies."""
        self.settings = get_settings()
        self.session = session

    def query_collection(
        self,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int = 5,
    ) -> CollectionQueryResponse:
        """Run a query against a collection and return scored chunks."""
        start_time = perf_counter()
        resolved = self._resolve_pipeline(user, collection)
        runner = PipelineRunner(self.session)
        handle = self._start_run(runner, resolved, user, collection, query, top_k)
        try:
            result = runner.execute(resolved.definition, handle)
            payload = self._extract_retrieval_payload(result.terminal_outputs)
            chunks = self._map_chunks(payload)
            latency_ms = (perf_counter() - start_time) * 1000
            event = self._record_query_event(
                user=user,
                collection=collection,
                query=query,
                top_k=top_k,
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
            return CollectionQueryResponse(
                query=query,
                top_k=top_k,
                chunks=chunks,
                usage=payload.usage.model_dump(),
                query_event_id=event.id,
                pipeline_run_id=handle.run.id,
            )
        except Exception as exc:
            handle.trace.mark_run_failed(exc)
            if is_external_provider_error(exc):
                raise ExternalServiceError(f"Retrieval pipeline failed: {exc}") from exc
            raise

    def _resolve_pipeline(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> ResolvedRetrievalPipeline:
        """Resolve the collection's retrieval pipeline, definition, and settings."""
        return resolve_retrieval_pipeline(self.session, user, collection)

    # pylint: disable-next=too-many-arguments,too-many-positional-arguments
    def _start_run(
        self,
        runner: PipelineRunner,
        resolved: ResolvedRetrievalPipeline,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int,
    ) -> PipelineRunHandle:
        """Resolve provider clients and start the retrieval pipeline run."""
        providers = ProviderResolver(user, self.session)
        vector_stores = VectorStoreProvider(user, self.session)
        version = resolved.service.get_current_version(resolved.pipeline)
        return runner.start(
            pipeline=resolved.pipeline,
            version=version,
            definition=resolved.definition,
            kind=models.PipelineKind.RETRIEVAL,
            user=user,
            collection=collection,
            settings=self.settings,
            providers=providers,
            vector_stores=vector_stores,
            storage=FileStorage(),
            query=query,
            top_k=top_k,
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
        resolved: ResolvedRetrievalPipeline,
        payload: RetrievalPayload,
        handle: PipelineRunHandle,
        latency_ms: float,
    ) -> models.QueryEvent:
        """Persist a `QueryEvent` recording this query's outcome and usage."""
        matches = payload.response.matches
        usage = payload.usage.model_dump()
        return QueryRepository(self.session).add_event(
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text=query,
                top_k=top_k,
                model=resolved.settings.embedding_model,
                context_tokens=self._context_tokens(payload.usage),
                latency_ms=latency_ms,
                response_payload={
                    "match_count": len(matches),
                    "max_score": max((match.score for match in matches), default=0.0),
                    "min_score": min((match.score for match in matches), default=0.0),
                    "pipeline_id": str(resolved.pipeline.id),
                    "usage": usage,
                },
                pipeline_run_id=handle.run.id,
            )
        )

    @staticmethod
    def _context_tokens(usage: TokenUsage) -> int:
        """Return the token count to record for a query, preferring the total."""
        return usage.total_tokens or usage.prompt_tokens or 0

    @staticmethod
    def _extract_retrieval_payload(
        terminal_outputs: dict[str, dict[str, object]],
    ) -> RetrievalPayload:
        """Return the retrieval payload from terminal outputs."""
        for outputs in terminal_outputs.values():
            if "result" in outputs:
                return RetrievalPayload.model_validate(outputs["result"])
        raise InvalidInputError("Pipeline did not return a retrieval result payload.")
