"""Retrieval service for collection queries."""

# pylint: disable=duplicate-code

from __future__ import annotations

from time import perf_counter

from sqlmodel import Session

from app.clients.openrouter import get_openrouter_client
from app.core.config import get_settings
from app.db import models
from app.db.repositories import QueryRepository
from app.pipelines.config import resolve_retrieval_settings
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.registry import default_registry
from app.pipelines.tracing import PipelineTraceRecorder
from app.retrieval.pinecone import get_pinecone_client
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk
from app.services.pipelines import PipelineService
from app.utils.file_storage import FileStorage
from app.utils.time import utc_now


class RetrievalService:  # pylint: disable=too-few-public-methods
    """Service for querying a collection's vector index."""

    def __init__(self, session: Session) -> None:
        """Initialize retrieval dependencies."""
        self.settings = get_settings()
        self.session = session

    def query_collection(  # pylint: disable=too-many-locals
        self,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int = 5,
    ) -> CollectionQueryResponse:
        """Run a query against a collection and return scored chunks."""
        start_time = perf_counter()
        pipeline_service = PipelineService(self.session)
        defaults = pipeline_service.ensure_default_pipelines(user)
        pipeline_service.ensure_collection_pipelines(collection, defaults)
        pipeline_id = collection.retrieval_pipeline_id or defaults.retrieval.id
        pipeline = pipeline_service.get_pipeline(pipeline_id, user.id)
        if not pipeline or pipeline.kind != models.PipelineKind.RETRIEVAL:
            raise ValueError("Retrieval pipeline could not be resolved.")
        definition = pipeline_service.get_definition(pipeline)
        retrieval_settings = resolve_retrieval_settings(definition, collection)
        openrouter = get_openrouter_client(user.openrouter_api_key or "")
        pinecone = get_pinecone_client(api_key=user.pinecone_api_key)
        version = pipeline_service.get_current_version(pipeline)
        run = models.PipelineRun(
            pipeline_id=pipeline.id,
            pipeline_version_id=version.id,
            pipeline_version=version.version,
            kind=models.PipelineKind.RETRIEVAL,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.RUNNING,
        )
        self.session.add(run)
        self.session.flush()
        trace = PipelineTraceRecorder(self.session, run, definition)
        executor = PipelineExecutor(default_registry())
        context = PipelineRunContext(
            session=self.session,
            user=user,
            collection=collection,
            document=None,
            query=query,
            top_k=top_k,
            openrouter=openrouter,
            pinecone=pinecone,
            storage=FileStorage(),
            settings=self.settings,
            trace=trace,
        )
        try:
            result = executor.execute(definition, context)
            payload = self._extract_retrieval_payload(result.terminal_outputs)
            response = payload.response
            chunks: list[RetrievedChunk] = []
            for scored in response.matches:
                chunks.append(
                    RetrievedChunk(
                        chunk_id=scored.chunk.chunk_id,
                        document_id=scored.chunk.document_id,
                        score=scored.score,
                        text=scored.chunk.text,
                        metadata=scored.chunk.metadata.data,
                    )
                )
            latency_ms = (perf_counter() - start_time) * 1000
            usage = payload.usage.model_dump()
            event = QueryRepository(self.session).add_event(
                models.QueryEvent(
                    user_id=user.id,
                    collection_id=collection.id,
                    query_text=query,
                    top_k=top_k,
                    model=retrieval_settings.embedding_model,
                    context_tokens=self._usage_tokens(usage),
                    latency_ms=latency_ms,
                    response_payload={
                        "match_count": len(response.matches),
                        "max_score": max(
                            (match.score for match in response.matches),
                            default=0.0,
                        ),
                        "min_score": min(
                            (match.score for match in response.matches),
                            default=0.0,
                        ),
                        "pipeline_id": str(pipeline.id),
                        "usage": usage,
                    },
                    pipeline_run_id=run.id,
                )
            )
            return CollectionQueryResponse(
                query=query,
                top_k=top_k,
                chunks=chunks,
                usage=usage,
                query_event_id=event.id,
                pipeline_run_id=run.id,
            )
        except Exception as exc:
            if run.status != models.PipelineRunStatus.FAILED:
                run.status = models.PipelineRunStatus.FAILED
                run.error_message = str(exc)
                run.completed_at = utc_now()
                self.session.add(run)
            raise

    @staticmethod
    def _extract_retrieval_payload(
        terminal_outputs: dict[str, dict[str, object]],
    ) -> RetrievalPayload:
        """Return the retrieval payload from terminal outputs."""
        for outputs in terminal_outputs.values():
            if "result" in outputs:
                return RetrievalPayload.model_validate(outputs["result"])
        raise ValueError("Pipeline did not return a retrieval result payload.")

    @staticmethod
    def _usage_tokens(usage: dict[str, int]) -> int:
        """Normalize usage payloads into a single token count."""
        for key in ("total_tokens", "prompt_tokens", "input_tokens"):
            value = usage.get(key)
            if isinstance(value, (int, float)):
                return int(value)
        total = sum(value for value in usage.values() if isinstance(value, (int, float)))
        return int(total)
