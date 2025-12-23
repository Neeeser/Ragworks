"""Ingestion service for uploaded documents."""

from __future__ import annotations

import logging
from typing import List

from fastapi import UploadFile
from pinecone import Pinecone
from sqlmodel import Session

from app.api.config import get_settings
from app.db import models
from app.db.repositories import ChunkRepository
from app.pipelines.config import resolve_ingestion_settings
from app.pipelines.payloads import IndexingPayload
from app.pipelines.registry import build_default_registry
from app.pipelines.runtime import PipelineExecutor, PipelineRunContext
from app.schemas.documents import DocumentRead, IngestionResponse
from app.services.openrouter import get_openrouter_client
from app.services.pipelines import PipelineService
from app.utils.file_storage import FileStorage
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


class IngestionService:  # pylint: disable=too-few-public-methods
    """Service for ingesting and indexing uploaded documents."""

    def __init__(self, session: Session) -> None:
        """Initialize the ingestion service with shared clients."""
        self.session = session
        self.settings = get_settings()
        self.storage = FileStorage()
        self.openrouter = get_openrouter_client()
        self._pinecone = Pinecone(api_key=self.settings.pinecone_api_key)
        self.chunks = ChunkRepository(session)

    # pylint: disable=too-many-locals
    def ingest_upload(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        upload: UploadFile,
    ) -> IngestionResponse:
        """Ingest a document upload and index its chunks."""
        pipeline_service = PipelineService(self.session)
        defaults = pipeline_service.ensure_default_pipelines(user)
        pipeline_service.ensure_collection_pipelines(collection, defaults)
        pipeline_id = collection.ingestion_pipeline_id or defaults.ingestion.id
        pipeline = pipeline_service.get_pipeline(pipeline_id, user.id)
        if not pipeline or pipeline.kind != models.PipelineKind.INGESTION:
            raise ValueError("Ingestion pipeline could not be resolved.")
        definition = pipeline_service.get_definition(pipeline)
        resolved = resolve_ingestion_settings(definition, collection)

        document = models.Document(
            collection_id=collection.id,
            user_id=user.id,
            name=upload.filename or "uploaded-document",
            content_type=upload.content_type or "text/plain",
            status=models.DocumentStatus.PROCESSING,
            chunk_size=resolved.chunk_size,
            chunk_overlap=resolved.chunk_overlap,
            chunk_strategy=resolved.chunk_strategy,
            embedding_model=resolved.embedding_model,
        )
        self.session.add(document)
        self.session.flush()

        relative_path = f"collections/{collection.id}/documents/{document.id}/{document.name}"
        path = self.storage.save_upload(upload, relative_path)
        document.source_path = str(path)
        self.session.add(document)

        try:
            executor = PipelineExecutor(build_default_registry())
            context = PipelineRunContext(
                session=self.session,
                user=user,
                collection=collection,
                document=document,
                query=None,
                top_k=None,
                openrouter=self.openrouter,
                pinecone=self._pinecone,
                storage=self.storage,
                settings=self.settings,
            )
            result = executor.execute(definition, context)
            payload = self._extract_indexing_payload(result.terminal_outputs)
            enriched_chunks = payload.chunks

            chunk_records: List[models.DocumentChunkRecord] = []
            for chunk in enriched_chunks:
                chunk_records.append(
                    models.DocumentChunkRecord(
                        document_id=document.id,
                        collection_id=collection.id,
                        chunk_index=chunk.order,
                        text=chunk.text,
                        embedding=chunk.embedding or [],
                        chunk_metadata=chunk.metadata.data,
                        chunk_size=resolved.chunk_size,
                        chunk_overlap=resolved.chunk_overlap,
                        chunk_strategy=resolved.chunk_strategy,
                        embedding_model=resolved.embedding_model,
                    )
                )
            self.chunks.add_many(chunk_records)

            document.status = models.DocumentStatus.READY
            document.num_chunks = len(chunk_records)
            document.num_tokens = sum(len(chunk.text.split()) for chunk in enriched_chunks)
            document.updated_at = utc_now()
            usage = payload.usage or {}
            self.session.add(
                models.IngestionEvent(
                    document_id=document.id,
                    collection_id=collection.id,
                    event_type="ingestion_complete",
                    status="success",
                    details={
                        "chunks": len(chunk_records),
                        "embedding_model": resolved.embedding_model,
                        "usage": usage,
                    },
                )
            )
            self.session.commit()

            return IngestionResponse(
                document=DocumentRead.from_model(document),
                chunk_count=len(chunk_records),
                pinecone_namespace=resolved.namespace or "",
                embedding_model=resolved.embedding_model,
                usage=usage,
            )
        except Exception as exc:
            document.status = models.DocumentStatus.FAILED
            document.updated_at = utc_now()
            self.session.add(
                models.IngestionEvent(
                    document_id=document.id,
                    collection_id=collection.id,
                    event_type="ingestion_failed",
                    status="error",
                    details={"error": str(exc)},
                )
            )
            self.session.commit()
            raise

    @staticmethod
    def _extract_indexing_payload(
        terminal_outputs: dict[str, dict[str, object]],
    ) -> IndexingPayload:
        """Find the indexing payload from terminal pipeline outputs."""
        for outputs in terminal_outputs.values():
            if "result" in outputs:
                return IndexingPayload.model_validate(outputs["result"])
        raise ValueError("Pipeline did not return an ingestion result payload.")
