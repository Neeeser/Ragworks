"""Ingestion service: run a file's ingestion pipeline and record the outcome.

Uploads persist files first (`FileSystemService.register_upload`); ingestion
runs afterwards — normally in a background task, whose session and claim
lifecycle live in `app/services/ingestion_worker.py`. A document row is the
honest record of the attempt: `ready` always means chunks were indexed; a
failure lands as `failed` with a descriptive `error_message`, a file no parse
node in the graph reads lands as `unsupported`, and the file itself stays.
"""

from __future__ import annotations

import time

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import ChunkRepository
from app.observability import events as log_events
from app.observability import get_logger
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.runner import PipelineRunHandle, PipelineRunner
from app.pipelines.payloads import IndexingPayload
from app.pipelines.settings import PipelineSettings
from app.pipelines.tracing import PipelineTraceRecorder
from app.providers.registry import ProviderResolver
from app.retrieval.models import DocumentChunk
from app.retrieval.tokenizers.resources import build_token_counter
from app.services.errors import (
    InvalidInputError,
    UnreadableContentTypeError,
    is_external_provider_error,
)
from app.services.pipeline_resolution import ResolvedPipeline, resolve_ingest_binding
from app.services.provider_errors import describe_provider_failure, provider_error
from app.telemetry import record
from app.telemetry.events import DocumentIngested
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider

logger = get_logger(__name__)


class IngestionService:
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
                self._purge_previous_derived_assets(self.storage, document)
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
            self._require_a_parse_node_read_the_file(payload, handle.context)
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
            # Read before the commit expires it: reloading returns the raw
            # column string, which has no `.value`.
            outcome = models.DocumentStatus(document.status).value
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
                    status=outcome,
                    index_backend=resolved.settings.backend.value,
                )
            )
            if is_external_provider_error(exc):
                raise provider_error(exc, context="Ingestion pipeline failed") from exc
            raise

    @staticmethod
    def _require_a_parse_node_read_the_file(
        payload: IndexingPayload, context: PipelineRunContext
    ) -> None:
        """End a run that indexed nothing because nothing parsed the file.

        A file every parse node declined never became content, so READY with
        no chunks would claim an ingestion that did not happen; a parsed file
        that yielded nothing (an empty text file) stays successful. The
        dedicated error type is what records the document as unsupported
        rather than failed.
        """
        if payload.chunks:
            return
        unclaimed = context.parse_report.unclaimed_media_types()
        if not unclaimed:
            return
        types = ", ".join(f"'{media_type}'" for media_type in unclaimed)
        raise UnreadableContentTypeError(
            f"No parse node handles {types}. Add a parse node that reads this "
            "format, or upload a format the ingestion pipeline already parses."
        )

    @staticmethod
    def _apply_settings(document: models.Document, resolved: PipelineSettings) -> None:
        """Sync the document's pipeline-derived columns for this attempt."""
        document.chunk_size = resolved.chunk_size
        document.chunk_overlap = resolved.chunk_overlap
        document.chunk_strategy = resolved.chunk_strategy
        document.embedding_model = resolved.embedding_model

    @staticmethod
    def _purge_previous_derived_assets(storage: FileStorage, document: models.Document) -> None:
        """Drop assets the last attempt derived, before this one writes its own.

        Extracted images are named by their position in the document, so a
        re-ingest that finds fewer images would otherwise leave the extra
        ones on disk pointed at by nothing.
        """
        storage.delete_tree(storage.derived_dir(document.collection_id, document.id))

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
            except Exception as exc:
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
        chunk_records: list[models.DocumentChunkRecord] = [
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
            for chunk in enriched_chunks
        ]
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
        # A pipeline that reads none of this file's formats declined it; the
        # run itself did nothing wrong, so it is not recorded as a failure.
        document.status = (
            models.DocumentStatus.UNSUPPORTED
            if isinstance(exc, UnreadableContentTypeError)
            else models.DocumentStatus.FAILED
        )
        # Background ingestion never raises to a caller, so this string is the
        # only account of the failure the file's owner ever sees -- a raw SDK
        # repr there leaves "out of credit" indistinguishable from an outage.
        document.error_message = (
            describe_provider_failure(exc, context="Ingestion failed")
            or str(exc)
            or exc.__class__.__name__
        )
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
