"""Retrieval service for collection queries."""

# pylint: disable=duplicate-code

from __future__ import annotations

from time import perf_counter

from sqlmodel import Session

from app.clients.openrouter import get_openrouter_client
from app.clients.pinecone import get_pinecone_client
from app.core.config import get_settings
from app.db import models
from app.db.repositories import QueryRepository
from app.pipelines.execution.runner import PipelineRunner
from app.pipelines.payloads import RetrievalPayload
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk
from app.services.pipeline_resolution import resolve_retrieval_pipeline
from app.utils.file_storage import FileStorage


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
        resolved = resolve_retrieval_pipeline(self.session, user, collection)
        openrouter = get_openrouter_client(user.openrouter_api_key or "")
        pinecone = get_pinecone_client(api_key=user.pinecone_api_key or "")
        runner = PipelineRunner(self.session)
        version = resolved.service.get_current_version(resolved.pipeline)
        handle = runner.start(
            pipeline=resolved.pipeline,
            version=version,
            definition=resolved.definition,
            kind=models.PipelineKind.RETRIEVAL,
            user=user,
            collection=collection,
            settings=self.settings,
            openrouter=openrouter,
            pinecone=pinecone,
            storage=FileStorage(),
            query=query,
            top_k=top_k,
        )
        try:
            result = runner.execute(resolved.definition, handle)
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
                    model=resolved.settings.embedding_model,
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
                        "pipeline_id": str(resolved.pipeline.id),
                        "usage": usage,
                    },
                    pipeline_run_id=handle.run.id,
                )
            )
            return CollectionQueryResponse(
                query=query,
                top_k=top_k,
                chunks=chunks,
                usage=usage,
                query_event_id=event.id,
                pipeline_run_id=handle.run.id,
            )
        except Exception as exc:
            handle.trace.mark_run_failed(exc)
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
