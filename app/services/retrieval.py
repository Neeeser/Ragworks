"""Retrieval service for collection queries."""

# pylint: disable=duplicate-code

from __future__ import annotations

from typing import List

from pinecone import Pinecone
from sqlmodel import Session

from app.api.config import get_settings
from app.db import models
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.registry import build_default_registry
from app.pipelines.runtime import PipelineExecutor, PipelineRunContext
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk
from app.services.openrouter import get_openrouter_client
from app.services.pipelines import PipelineService
from app.utils.file_storage import FileStorage


class RetrievalService:  # pylint: disable=too-few-public-methods
    """Service for querying a collection's vector index."""

    def __init__(self, session: Session) -> None:
        """Initialize retrieval dependencies."""
        self.settings = get_settings()
        self._pinecone = Pinecone(api_key=self.settings.pinecone_api_key)
        self.openrouter = get_openrouter_client()
        self.session = session

    def query_collection(  # pylint: disable=too-many-locals
        self,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int = 5,
    ) -> CollectionQueryResponse:
        """Run a query against a collection and return scored chunks."""
        pipeline_service = PipelineService(self.session)
        defaults = pipeline_service.ensure_default_pipelines(user)
        pipeline_service.ensure_collection_pipelines(collection, defaults)
        pipeline_id = collection.retrieval_pipeline_id or defaults.retrieval.id
        pipeline = pipeline_service.get_pipeline(pipeline_id, user.id)
        if not pipeline or pipeline.kind != models.PipelineKind.RETRIEVAL:
            raise ValueError("Retrieval pipeline could not be resolved.")
        definition = pipeline_service.get_definition(pipeline)
        executor = PipelineExecutor(build_default_registry())
        context = PipelineRunContext(
            session=self.session,
            user=user,
            collection=collection,
            document=None,
            query=query,
            top_k=top_k,
            openrouter=self.openrouter,
            pinecone=self._pinecone,
            storage=FileStorage(),
            settings=self.settings,
        )
        result = executor.execute(definition, context)
        payload = self._extract_retrieval_payload(result.terminal_outputs)
        response = payload.response
        chunks: List[RetrievedChunk] = []
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
        return CollectionQueryResponse(
            query=query,
            top_k=top_k,
            chunks=chunks,
            usage=payload.usage or {},
        )

    @staticmethod
    def _extract_retrieval_payload(
        terminal_outputs: dict[str, dict[str, object]],
    ) -> RetrievalPayload:
        """Return the retrieval payload from terminal outputs."""
        for outputs in terminal_outputs.values():
            if "result" in outputs:
                return RetrievalPayload.model_validate(outputs["result"])
        raise ValueError("Pipeline did not return a retrieval result payload.")
