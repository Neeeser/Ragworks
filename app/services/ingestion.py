"""Ingestion service for uploaded documents."""

from __future__ import annotations

import logging

from fastapi import UploadFile
from sqlmodel import Session

from app.clients.openrouter import get_openrouter_client
from app.core.config import get_settings
from app.db import models
from app.db.repositories import ChunkRepository
from app.pipelines.config import IngestionPipelineSettings, resolve_ingestion_settings
from app.pipelines.definition import PipelineDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.payloads import IndexingPayload
from app.pipelines.registry import default_registry
from app.pipelines.tracing import PipelineTraceRecorder
from app.retrieval.models import DocumentChunk
from app.retrieval.pinecone import get_pinecone_client
from app.schemas.documents import DocumentRead, IngestionResponse
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
        (
            pipeline_service,
            pipeline,
            definition,
            resolved,
        ) = self._resolve_ingestion_pipeline(user, collection)
        document = self._create_document_record(user, collection, upload, resolved)
        self._save_document_upload(collection, document, upload)
        run: models.PipelineRun | None = None
        try:
            openrouter = get_openrouter_client(user.openrouter_api_key or "")
            pinecone = get_pinecone_client(api_key=user.pinecone_api_key)
            run, trace = self._start_trace_run(
                pipeline_service,
                pipeline,
                definition,
                document,
            )
            executor = PipelineExecutor(default_registry())
            context = PipelineRunContext(
                session=self.session,
                user=user,
                collection=collection,
                document=document,
                query=None,
                top_k=None,
                openrouter=openrouter,
                pinecone=pinecone,
                storage=self.storage,
                settings=self.settings,
                trace=trace,
            )
            result = executor.execute(definition, context)
            payload = self._extract_indexing_payload(result.terminal_outputs)
            enriched_chunks = payload.chunks
            usage = payload.usage.model_dump()
            chunk_records = self._persist_chunks(
                document,
                collection,
                enriched_chunks,
                resolved,
            )
            self._record_success(
                document,
                resolved.embedding_model,
                usage,
                chunk_records,
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
            self._record_failure(document, run, exc)
            self.session.commit()
            raise

    def _resolve_ingestion_pipeline(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> tuple[
        PipelineService,
        models.Pipeline,
        PipelineDefinition,
        IngestionPipelineSettings,
    ]:
        """Resolve ingestion pipeline definition and settings."""
        pipeline_service = PipelineService(self.session)
        defaults = pipeline_service.ensure_default_pipelines(user)
        pipeline_service.ensure_collection_pipelines(collection, defaults)
        pipeline_id = collection.ingestion_pipeline_id or defaults.ingestion.id
        pipeline = pipeline_service.get_pipeline(pipeline_id, user.id)
        if not pipeline or pipeline.kind != models.PipelineKind.INGESTION:
            raise ValueError("Ingestion pipeline could not be resolved.")
        definition = pipeline_service.get_definition(pipeline)
        resolved = resolve_ingestion_settings(definition, collection)
        return pipeline_service, pipeline, definition, resolved

    def _create_document_record(
        self,
        user: models.User,
        collection: models.Collection,
        upload: UploadFile,
        resolved: IngestionPipelineSettings,
    ) -> models.Document:
        """Create and persist a document record for ingestion."""
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
        return document

    def _save_document_upload(
        self,
        collection: models.Collection,
        document: models.Document,
        upload: UploadFile,
    ) -> None:
        """Persist the uploaded file to storage."""
        relative_path = f"collections/{collection.id}/documents/{document.id}/{document.name}"
        path = self.storage.save_upload(upload, relative_path)
        document.source_path = str(path)
        self.session.add(document)

    def _start_trace_run(
        self,
        pipeline_service: PipelineService,
        pipeline: models.Pipeline,
        definition: PipelineDefinition,
        document: models.Document,
    ) -> tuple[models.PipelineRun, PipelineTraceRecorder]:
        """Create a pipeline run and trace recorder."""
        version = pipeline_service.get_current_version(pipeline)
        run = models.PipelineRun(
            pipeline_id=pipeline.id,
            pipeline_version_id=version.id,
            pipeline_version=version.version,
            kind=models.PipelineKind.INGESTION,
            user_id=document.user_id,
            collection_id=document.collection_id,
            status=models.PipelineRunStatus.RUNNING,
            started_at=utc_now(),
        )
        self.session.add(run)
        self.session.flush()
        document.ingestion_run_id = run.id
        self.session.add(document)
        trace = PipelineTraceRecorder(self.session, run, definition)
        return run, trace

    def _persist_chunks(
        self,
        document: models.Document,
        collection: models.Collection,
        enriched_chunks: list[DocumentChunk],
        resolved: IngestionPipelineSettings,
    ) -> list[models.DocumentChunkRecord]:
        """Persist embedded chunks and update document metadata."""
        chunk_records: list[models.DocumentChunkRecord] = []
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
        return chunk_records

    def _record_success(
        self,
        document: models.Document,
        embedding_model: str,
        usage: dict[str, int],
        chunk_records: list[models.DocumentChunkRecord],
    ) -> None:
        """Record a successful ingestion event."""
        self.session.add(
            models.IngestionEvent(
                document_id=document.id,
                collection_id=document.collection_id,
                event_type="ingestion_complete",
                status="success",
                details={
                    "chunks": len(chunk_records),
                    "embedding_model": embedding_model,
                    "usage": usage,
                },
            )
        )

    def _record_failure(
        self,
        document: models.Document,
        run: models.PipelineRun | None,
        exc: Exception,
    ) -> None:
        """Record ingestion failure metadata."""
        document.status = models.DocumentStatus.FAILED
        if run and run.status != models.PipelineRunStatus.FAILED:
            run.status = models.PipelineRunStatus.FAILED
            run.error_message = str(exc)
            run.completed_at = utc_now()
            self.session.add(run)
        self.session.add(
            models.IngestionEvent(
                document_id=document.id,
                collection_id=document.collection_id,
                event_type="ingestion_failed",
                status="error",
                details={"error": str(exc)},
            )
        )

    @staticmethod
    def _extract_indexing_payload(
        terminal_outputs: dict[str, dict[str, object]],
    ) -> IndexingPayload:
        """Find the indexing payload from terminal pipeline outputs."""
        for outputs in terminal_outputs.values():
            if "result" in outputs:
                return IndexingPayload.model_validate(outputs["result"])
        raise ValueError("Pipeline did not return an ingestion result payload.")
