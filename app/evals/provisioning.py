"""Provision (or reuse) the eval collection that holds a run's sampled corpus.

An eval collection is system-managed scaffolding: a real collection tagged
`system_purpose="eval"`, materialized from the benchmark corpus and ingested with
the ingestion pipeline under test. It is cache-keyed by
`(dataset, sampled corpus, ingestion pipeline definition)`, so a second run with
the same ingestion pipeline reuses the already-embedded collection and only the
retrieval side re-runs. Per-gold-document ingestion outcomes feed the funnel's
stage 0 (indexed coverage).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlmodel import Session, col, select

from app.db import models
from app.db.engine import session_scope
from app.db.repositories import CollectionRepository, DocumentRepository
from app.schemas.enums import CollectionPurpose
from app.services.errors import InvalidInputError
from app.services.files import FileSystemService, UploadSpec
from app.services.ingestion import IngestionService
from app.services.pipelines import PipelineService

logger = logging.getLogger(__name__)

EVAL_CACHE_KEY = "eval_cache_key"
EVAL_DATASET_KEY = "eval_dataset_id"

ProgressCallback = Callable[[], None]


@dataclass(frozen=True)
class ProvisionResult:
    """The eval collection for a run plus per-document ingestion outcomes."""

    collection: models.Collection
    reused: bool
    indexed_external_ids: set[str]
    failed_external_ids: set[str]


@dataclass(frozen=True)
class ProvisionSpec:
    """What identifies the eval collection one run needs, and how hard to ingest.

    `concurrency` only paces the ingest worker pool; it never affects the
    cache key or the resulting collection's contents.
    """

    dataset: models.EvalDataset
    cache_key: str
    ingestion_pipeline: models.Pipeline
    retrieval_pipeline: models.Pipeline
    concurrency: int = 1


def compute_cache_key(
    dataset_id: UUID,
    corpus_hash: str,
    ingestion_definition: dict[str, object],
) -> str:
    """Content-address a (dataset, sampled corpus, ingestion pipeline) triple."""
    canonical = json.dumps(
        {
            "dataset_id": str(dataset_id),
            "corpus_hash": corpus_hash,
            "ingestion": ingestion_definition,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


class EvalProvisioner:
    """Create or reuse the ingested eval collection for one run."""

    def __init__(self, session: Session) -> None:
        """Bind the provisioner to the run's session."""
        self.session = session
        self.collections = CollectionRepository(session)
        self.pipelines = PipelineService(session)

    def cache_key_for(
        self,
        dataset: models.EvalDataset,
        corpus_hash: str,
        ingestion_pipeline: models.Pipeline,
    ) -> str:
        """Compute the cache key from the pipeline's current stored definition."""
        definition = self.pipelines.get_definition(ingestion_pipeline)
        return compute_cache_key(dataset.id, corpus_hash, definition.model_dump(mode="json"))

    def find_existing(self, user: models.User, cache_key: str) -> models.Collection | None:
        """Return the user's eval collection for this cache key, if provisioned."""
        statement = select(models.Collection).where(
            col(models.Collection.user_id) == user.id,
            col(models.Collection.system_purpose) == CollectionPurpose.EVAL.value,
        )
        for collection in self.session.exec(statement).all():
            if collection.extra_metadata.get(EVAL_CACHE_KEY) == cache_key:
                return collection
        return None

    def provision(
        self,
        *,
        user: models.User,
        spec: ProvisionSpec,
        corpus_docs: list[models.EvalDatasetDocument],
        on_document_done: ProgressCallback | None = None,
    ) -> ProvisionResult:
        """Ensure an ingested eval collection exists for this cache key.

        On reuse, only the retrieval pipeline binding is updated. On a fresh
        provision, every corpus document is materialized as a file and ingested
        with the ingestion pipeline under test; a document that fails to ingest
        is recorded (stage-0 funnel loss), never fatal to the run.
        """
        existing = self.find_existing(user, spec.cache_key)
        if existing is not None:
            self._bind_retrieval(existing, spec.retrieval_pipeline)
            indexed, failed = self._ingestion_outcomes(existing.id)
            return ProvisionResult(
                collection=existing,
                reused=True,
                indexed_external_ids=indexed,
                failed_external_ids=failed,
            )

        collection = models.Collection(
            id=uuid4(),
            user_id=user.id,
            name=f"Eval: {spec.dataset.name} [{spec.cache_key[:8]}]",
            description=f"Benchmark corpus for eval runs against '{spec.dataset.name}'.",
            ingestion_pipeline_id=spec.ingestion_pipeline.id,
            retrieval_pipeline_id=spec.retrieval_pipeline.id,
            system_purpose=CollectionPurpose.EVAL.value,
            extra_metadata={
                EVAL_CACHE_KEY: spec.cache_key,
                EVAL_DATASET_KEY: str(spec.dataset.id),
            },
        )
        self.collections.add(collection)
        self.session.commit()
        self.session.refresh(collection)

        self._materialize_and_ingest(user, collection, corpus_docs, on_document_done, spec)
        indexed, failed = self._ingestion_outcomes(collection.id)
        return ProvisionResult(
            collection=collection,
            reused=False,
            indexed_external_ids=indexed,
            failed_external_ids=failed,
        )

    def document_mapping(self, collection_id: UUID) -> dict[str, str]:
        """Map Ragworks document UUIDs (str) to benchmark external doc ids."""
        return {
            str(document.id): _external_id_from_name(document.name)
            for document in DocumentRepository(self.session).list_for_collection(collection_id)
        }

    def _bind_retrieval(
        self, collection: models.Collection, retrieval_pipeline: models.Pipeline
    ) -> None:
        """Point the reused eval collection at this run's retrieval pipeline."""
        if collection.retrieval_pipeline_id == retrieval_pipeline.id:
            return
        collection.retrieval_pipeline_id = retrieval_pipeline.id
        self.session.add(collection)
        self.session.commit()

    def _materialize_and_ingest(
        self,
        user: models.User,
        collection: models.Collection,
        corpus_docs: list[models.EvalDatasetDocument],
        on_document_done: ProgressCallback | None,
        spec: ProvisionSpec,
    ) -> None:
        """Write every corpus doc as a file, then ingest across the worker pool.

        Registration stays serial on the provisioner's session (fast, local,
        and sibling-name checks want one writer). Ingestion is serial only
        until the first document succeeds — that first ingest creates the
        pipeline's indexes, so pooled workers never race index creation — then
        the remainder fans out, each worker in its own session.
        """
        files = FileSystemService(self.session)
        document_ids = [
            self._register(files, user, collection, corpus_doc).id
            for corpus_doc in corpus_docs
        ]
        self.session.commit()

        remaining = list(document_ids)
        while remaining:
            succeeded = _ingest_one(user.id, collection.id, remaining.pop(0))
            if on_document_done is not None:
                on_document_done()
            if succeeded:
                break
        if not remaining:
            return
        with ThreadPoolExecutor(max_workers=max(spec.concurrency, 1)) as pool:
            futures = [
                pool.submit(_ingest_one, user.id, collection.id, document_id)
                for document_id in remaining
            ]
            for future in as_completed(futures):
                future.result()
                if on_document_done is not None:
                    on_document_done()

    @staticmethod
    def _register(
        files: FileSystemService,
        user: models.User,
        collection: models.Collection,
        corpus_doc: models.EvalDatasetDocument,
    ) -> models.Document:
        """Persist one corpus doc as a file node plus a pending document row."""
        content = corpus_doc.text
        if corpus_doc.title:
            content = f"{corpus_doc.title}\n\n{corpus_doc.text}"
        spec = UploadSpec(
            filename=_file_name_for(corpus_doc.external_doc_id),
            content_type="text/plain",
        )
        result = files.register_upload(
            user, collection, spec, io.BytesIO(content.encode("utf-8"))
        )
        if result.document is not None:
            return result.document
        # Eligibility gates auto-ingestion only; eval provisioning always ingests.
        document = files.ensure_pending_document(user, collection, result.file)
        files.session.commit()
        return document

    def _ingestion_outcomes(self, collection_id: UUID) -> tuple[set[str], set[str]]:
        """Split the collection's documents into indexed vs failed external ids."""
        # Ingest workers wrote document statuses in their own sessions; drop
        # this session's cached instances so the read reflects the database.
        self.session.expire_all()
        indexed: set[str] = set()
        failed: set[str] = set()
        for document in DocumentRepository(self.session).list_for_collection(collection_id):
            external_id = _external_id_from_name(document.name)
            if document.status == models.DocumentStatus.READY and document.num_chunks > 0:
                indexed.add(external_id)
            else:
                failed.add(external_id)
        return indexed, failed


def _ingest_one(user_id: UUID, collection_id: UUID, document_id: UUID) -> bool:
    """Ingest one registered corpus document in its own session.

    Worker-safe: loads its rows fresh and never touches the provisioner's
    session. A failure is deliberately non-fatal, mirroring background
    ingestion — the FAILED document row is the recorded outcome (stage-0
    funnel loss), and one unparseable/failing doc must not kill the run.
    """
    with session_scope() as session:
        user = session.get(models.User, user_id)
        collection = session.get(models.Collection, collection_id)
        document = session.get(models.Document, document_id)
        if user is None or collection is None or document is None:
            return False
        try:
            IngestionService(session).ingest_document(
                user=user, collection=collection, document=document
            )
        except Exception:  # pylint: disable=broad-exception-caught
            # Deliberately broad: see docstring.
            logger.exception("Eval corpus document %s failed to ingest", document.name)
            return False
        return True


def _file_name_for(external_doc_id: str) -> str:
    """Build the file name that encodes a corpus doc's external id."""
    safe = external_doc_id.replace("/", "_")
    if not safe:
        raise InvalidInputError("Corpus document has an empty external id.")
    return f"{safe}.txt"


def _external_id_from_name(name: str) -> str:
    """Recover the external doc id from the file/document name."""
    return name.removesuffix(".txt")
