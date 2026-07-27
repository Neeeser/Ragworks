"""Ingestion service: run a file's ingestion pipeline and record the outcome.

Uploads persist files first (`FileSystemService.register_upload`); ingestion
runs afterwards — normally in a background task via `run_document_ingestion`,
which owns its own session. A document row is the honest record of the
attempt: `ready` always means chunks were indexed; any failure lands as
`failed` with a descriptive `error_message`, and the file itself stays.
"""

from __future__ import annotations

import time
from uuid import UUID, uuid4

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.engine import session_scope
from app.db.repositories import ChunkRepository, DocumentRepository
from app.observability import events as log_events
from app.observability import get_logger, request_context
from app.pipelines.execution.runner import PipelineRunHandle, PipelineRunner
from app.pipelines.payloads import IndexingPayload
from app.pipelines.settings import PipelineSettings
from app.pipelines.tracing import PipelineTraceRecorder
from app.providers.registry import ProviderResolver
from app.retrieval.models import DocumentChunk
from app.retrieval.tokenizers.resources import build_token_counter
from app.services.errors import ExternalServiceError, InvalidInputError, is_external_provider_error
from app.services.pipeline_resolution import ResolvedPipeline, resolve_ingest_binding
from app.telemetry import record
from app.telemetry.events import DocumentIngested
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider

logger = get_logger(__name__)


def run_document_ingestion(document_id: UUID, request_id: str | None = None) -> None:
    """Worker entry point: claim and ingest one pending document, never raise.

    Opens its own `session_scope` — queue workers run outside any request
    (and its session). The atomic `pending` → `processing` claim is the
    dedupe gate: a duplicate enqueue of the same document loses the claim
    and returns without touching it. Failures are already recorded on the
    document row by `ingest_document`; this wrapper only keeps the worker
    quiet.

    `request_id` carries the enqueuing request's correlation ID into the
    worker's logs; a fresh one is minted when the work has no originating
    request (startup recovery).
    """
    with request_context(request_id=request_id or str(uuid4())), session_scope() as session:
        if not DocumentRepository(session).claim_for_ingestion(document_id):
            return
        session.commit()  # make the claim visible to pollers and other workers
        document = session.get(models.Document, document_id)
        if document is None:
            return
        user = session.get(models.User, document.user_id)
        collection = session.get(models.Collection, document.collection_id)
        if user is None or collection is None:
            return
        try:
            IngestionService(session).ingest_document(
                user=user, collection=collection, document=document
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # Deliberately broad: the outcome is normally already persisted
            # as a FAILED document with an error message; a queue worker has
            # no caller left to re-raise to.
            logger.error(
                log_events.BACKGROUND_TASK_FAILED,
                task="ingestion",
                document_id=str(document_id),
                error_type=exc.__class__.__name__,
                exc_info=True,
            )
            _ensure_failure_recorded(document_id, exc)


def _ensure_failure_recorded(document_id: UUID, exc: Exception) -> None:
    """Last-resort FAILED write on a fresh session; never leaves `processing`.

    `ingest_document` records failures on its own session — but when that
    session's transaction is already aborted (e.g. an `IntegrityError` from
    concurrent index DDL), its failure-recording commit raises too and the
    document would stay `processing` forever with no error. A fresh session
    is immune to the poisoned one, so the honest FAILED outcome always lands.
    """
    try:
        with session_scope() as session:
            document = session.get(models.Document, document_id)
            if document is None or document.status != models.DocumentStatus.PROCESSING:
                return
            document.status = models.DocumentStatus.FAILED
            document.error_message = str(exc) or exc.__class__.__name__
            session.add(document)
    except Exception:  # pylint: disable=broad-exception-caught
        # Swallowing here is deliberate: this is the recorder of last resort,
        # and raising from it would only kill the worker thread.
        logger.error(
            log_events.BACKGROUND_TASK_FAILED,
            task="ingestion_failure_recording",
            document_id=str(document_id),
            exc_info=True,
        )


class IngestionService:  # pylint: disable=too-few-public-methods
    """Service for running a document's ingestion pipeline."""

    def __init__(self, session: Session) -> None:
        """Initialize the ingestion service with shared clients."""
        self.session = session
        self.settings = get_settings()
        self.storage = FileStorage()
        self.chunks = ChunkRepository(session)

    def ingest_document(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        document: models.Document,
    ) -> models.Document:
        """Run the collection's ingestion pipeline for one document row.

        The row is expected `pending` with its file fields synced
        (`FileSystemService.ensure_pending_document`); retry reuses the same
        row, so a previous attempt's chunk rows and vectors are cleared first.
        """
        resolved = resolve_ingest_binding(self.session, user, collection)
        is_retry = document.ingestion_run_id is not None
        self._apply_settings(document, resolved.settings)
        document.status = models.DocumentStatus.PROCESSING
        document.error_message = None
        document.warnings = []
        self.chunks.delete_for_document(document.id)
        self.session.add(document)
        self.session.commit()  # make `processing` visible to pollers mid-run

        logger.info(
            log_events.INGESTION_STARTED,
            document_id=str(document.id),
            collection_id=str(collection.id),
            index_backend=resolved.settings.backend.value,
            is_retry=is_retry,
        )
        started_at = time.perf_counter()
        runner = PipelineRunner(self.session)
        handle: PipelineRunHandle | None = None
        try:
            providers = ProviderResolver(user, self.session)
            vector_stores = VectorStoreProvider(user, self.session)
            if is_retry:
                self._purge_previous_vectors(vector_stores, resolved, document)
            handle = runner.start(
                pipeline=resolved.pipeline,
                version=resolved.service.get_current_version(resolved.pipeline),
                definition=resolved.definition,
                trigger=models.BindingRole.INGEST,
                user=user,
                collection=collection,
                settings=self.settings,
                providers=providers,
                vector_stores=vector_stores,
                storage=self.storage,
                document=document,
            )
            document.ingestion_run_id = handle.run.id
            self.session.add(document)
            result = runner.execute(handle)
            payload = self._extract_indexing_payload(result.terminal_outputs)
            document.warnings = [*handle.run.warnings]
            chunk_records = self._persist_chunks(
                document, collection, payload.chunks, resolved.settings
            )
            self._record_success(
                document,
                resolved.settings.embedding_model,
                payload.usage.model_dump(),
                chunk_records,
            )
            self.session.commit()
            logger.info(
                log_events.INGESTION_COMPLETED,
                document_id=str(document.id),
                collection_id=str(collection.id),
                index_backend=resolved.settings.backend.value,
                chunk_count=len(chunk_records),
                duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
            )
            record(
                DocumentIngested(
                    user_id=user.id,
                    collection_id=collection.id,
                    document_id=document.id,
                    status=models.DocumentStatus.READY.value,
                    chunk_count=len(chunk_records),
                    index_backend=resolved.settings.backend.value,
                )
            )
            return document
        except Exception as exc:
            self._record_failure(document, handle.trace if handle else None, exc)
            self.session.commit()
            logger.error(
                log_events.INGESTION_FAILED,
                document_id=str(document.id),
                collection_id=str(collection.id),
                index_backend=resolved.settings.backend.value,
                error_type=exc.__class__.__name__,
                external=is_external_provider_error(exc),
                duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
                exc_info=True,
            )
            record(
                DocumentIngested(
                    user_id=user.id,
                    collection_id=collection.id,
                    document_id=document.id,
                    status=models.DocumentStatus.FAILED.value,
                    index_backend=resolved.settings.backend.value,
                )
            )
            if is_external_provider_error(exc):
                raise ExternalServiceError(f"Ingestion pipeline failed: {exc}") from exc
            raise

    @staticmethod
    def _apply_settings(document: models.Document, resolved: PipelineSettings) -> None:
        """Sync the document's pipeline-derived columns for this attempt."""
        document.chunk_size = resolved.chunk_size
        document.chunk_overlap = resolved.chunk_overlap
        document.chunk_strategy = resolved.chunk_strategy
        document.embedding_model = resolved.embedding_model

    @staticmethod
    def _purge_previous_vectors(
        vector_stores: VectorStoreProvider,
        resolved: ResolvedPipeline,
        document: models.Document,
    ) -> None:
        """Best-effort purge of a previous attempt's vectors before re-indexing.

        Re-ingestion upserts the same `{document_id}:{order}` ids, so at worst
        a failed purge leaves stale tail chunks when the new run produces
        fewer chunks — never corruption. That's why (documented exception to
        the never-swallow rule) purge failure logs and continues instead of
        blocking the retry: the common cause is an index that was never
        created because the first attempt failed before indexing.
        """
        namespace = resolved.settings.namespace
        if not namespace:
            return
        for target in resolved.settings.index_targets:
            try:
                store = vector_stores.get(target.backend)
                store.delete_document_vectors(target.index_name, namespace, str(document.id))
            except Exception as exc:  # pylint: disable=broad-exception-caught
                logger.warning(
                    log_events.VECTORSTORE_CALL_FAILED,
                    operation="purge_previous_vectors",
                    document_id=str(document.id),
                    index_backend=target.backend.value,
                    error_type=exc.__class__.__name__,
                )

    def _persist_chunks(
        self,
        document: models.Document,
        collection: models.Collection,
        enriched_chunks: list[DocumentChunk],
        resolved: PipelineSettings,
    ) -> list[models.DocumentChunkRecord]:
        """Persist embedded chunks and update document metadata."""
        token_counter = build_token_counter(resolved.tokenizer, self.settings.storage_path)
        chunk_records: list[models.DocumentChunkRecord] = []
        for chunk in enriched_chunks:
            chunk_records.append(
                models.DocumentChunkRecord(
                    document_id=document.id,
                    collection_id=collection.id,
                    chunk_index=chunk.order,
                    text=chunk.text,
                    token_count=token_counter.count(chunk.text),
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
        document.num_tokens = sum(chunk.token_count for chunk in chunk_records)
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
        trace: PipelineTraceRecorder | None,
        exc: Exception,
    ) -> None:
        """Record ingestion failure metadata.

        Run-status transitions belong to the trace recorder (`mark_run_failed`
        is a no-op on an already-failed run); this method owns only the
        document status/error and the ingestion event.
        """
        document.status = models.DocumentStatus.FAILED
        document.error_message = str(exc) or exc.__class__.__name__
        if trace:
            trace.mark_run_failed(exc)
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
        raise InvalidInputError("Pipeline did not return an ingestion result payload.")
