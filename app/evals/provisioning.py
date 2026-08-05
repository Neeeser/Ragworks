"""Provision (or reuse) the eval collection that holds a run's sampled corpus.

An eval collection is system-managed scaffolding: a real collection tagged
`system_purpose="eval"`, materialized from the benchmark corpus and ingested with
the ingestion pipeline under test. It is cache-keyed by
`(dataset, ingestion pipeline definition)`: a second run with the same ingestion
pipeline reuses the already-embedded collection and ingests only the sampled
documents not yet in it, while any edit to the pipeline definition changes the
key and provisions a fresh collection. Per-gold-document ingestion outcomes feed
the funnel's stage 0 (indexed coverage).
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlmodel import Session, col, select

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    DocumentRepository,
    reached_the_index,
)
from app.evals.corpus_documents import (
    ProgressCallback,
    external_id_from_name,
    file_name_for,
    ingest_all,
)
from app.schemas.enums import CollectionPurpose
from app.services.files import FileSystemService, UploadSpec
from app.services.pipelines import PipelineService

EVAL_CACHE_KEY = "eval_cache_key"
EVAL_DATASET_KEY = "eval_dataset_id"


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
    ingestion_definition: dict[str, object],
) -> str:
    """Content-address a (dataset, ingestion pipeline definition) pair.

    Deliberately excludes the run's sampled corpus: a larger later run tops up
    the same collection with only its missing documents, so growing a sample
    never re-ingests what an earlier run already embedded.
    """
    canonical = json.dumps(
        {
            "dataset_id": str(dataset_id),
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
        ingestion_pipeline: models.Pipeline,
    ) -> str:
        """Compute the cache key from the pipeline's current stored definition."""
        definition = self.pipelines.get_definition(ingestion_pipeline)
        return compute_cache_key(dataset.id, definition.model_dump(mode="json"))

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

        On reuse, the retrieval pipeline binding is updated, the sampled
        documents not already in the collection are materialized and ingested
        — a larger run tops up the earlier run's collection — and the ones an
        earlier run left out of the index are re-attempted. On a fresh
        provision, every corpus document is ingested. Either way, a document
        that fails to ingest is recorded (stage-0 funnel loss), never fatal
        to the run.
        """
        existing = self.find_existing(user, spec.cache_key)
        if existing is not None:
            self._bind_retrieval(existing, spec.retrieval_pipeline)
            self._materialize_and_ingest(
                user,
                existing,
                self._missing_docs(existing.id, corpus_docs),
                on_document_done,
                spec.concurrency,
            )
            self._reingest_unindexed(
                user, existing, corpus_docs, on_document_done, spec.concurrency
            )
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
            system_purpose=CollectionPurpose.EVAL.value,
            extra_metadata={
                EVAL_CACHE_KEY: spec.cache_key,
                EVAL_DATASET_KEY: str(spec.dataset.id),
            },
        )
        self.collections.add(collection)
        self.session.flush()
        bindings = CollectionPipelineBindingRepository(self.session)
        bindings.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=spec.ingestion_pipeline.id,
                role=models.BindingRole.INGEST,
            )
        )
        bindings.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=spec.retrieval_pipeline.id,
                role=models.BindingRole.TOOL,
                is_primary=True,
            )
        )
        self.session.commit()
        self.session.refresh(collection)

        self._materialize_and_ingest(
            user, collection, corpus_docs, on_document_done, spec.concurrency
        )
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
            str(document.id): external_id_from_name(document.name)
            for document in DocumentRepository(self.session).list_for_collection(collection_id)
        }

    def _missing_docs(
        self, collection_id: UUID, corpus_docs: list[models.EvalDatasetDocument]
    ) -> list[models.EvalDatasetDocument]:
        """The sampled corpus docs not yet materialized in the collection.

        Compares stored file names (not recovered external ids) so ids the
        file-name sanitizer rewrites ("/" -> "_") still match their document.
        """
        present = {
            document.name
            for document in DocumentRepository(self.session).list_for_collection(collection_id)
        }
        return [doc for doc in corpus_docs if file_name_for(doc.external_doc_id) not in present]

    def _bind_retrieval(
        self, collection: models.Collection, retrieval_pipeline: models.Pipeline
    ) -> None:
        """Point the reused eval collection's primary tool at this run's pipeline."""
        bindings = CollectionPipelineBindingRepository(self.session)
        tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
        primary = next((b for b in tools if b.is_primary), tools[0] if tools else None)
        if primary is not None and primary.pipeline_id == retrieval_pipeline.id:
            return
        if primary is None:
            bindings.add(
                models.CollectionPipelineBinding(
                    collection_id=collection.id,
                    pipeline_id=retrieval_pipeline.id,
                    role=models.BindingRole.TOOL,
                    is_primary=True,
                )
            )
        else:
            primary.pipeline_id = retrieval_pipeline.id
            self.session.add(primary)
        self.session.commit()

    def _materialize_and_ingest(
        self,
        user: models.User,
        collection: models.Collection,
        corpus_docs: list[models.EvalDatasetDocument],
        on_document_done: ProgressCallback | None,
        concurrency: int,
    ) -> None:
        """Write every corpus doc as a file, then ingest it.

        Registration stays serial on the provisioner's session (fast, local,
        and sibling-name checks want one writer).
        """
        if not corpus_docs:
            return
        files = FileSystemService(self.session)
        document_ids = [
            self._register(files, user, collection, corpus_doc).id for corpus_doc in corpus_docs
        ]
        self.session.commit()
        ingest_all(user.id, collection.id, document_ids, on_document_done, concurrency)

    def _reingest_unindexed(
        self,
        user: models.User,
        collection: models.Collection,
        corpus_docs: list[models.EvalDatasetDocument],
        on_document_done: ProgressCallback | None,
        concurrency: int,
    ) -> None:
        """Re-attempt sampled documents an earlier run left out of the index.

        `_missing_docs` only sees documents that were never materialized, so a
        document whose ingestion failed reads as present and is skipped —
        without this the failure is permanent for this cache key and starting
        another run could never repair it.
        """
        # Ingest workers wrote document statuses in their own sessions; drop
        # this session's cached instances so the read reflects the database.
        self.session.expire_all()
        names = {file_name_for(doc.external_doc_id) for doc in corpus_docs}
        stale = DocumentRepository(self.session).list_unindexed_for_collection(
            collection.id, names=names
        )
        if not stale:
            return
        ingest_all(
            user.id,
            collection.id,
            [document.id for document in stale],
            on_document_done,
            concurrency,
        )

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
            filename=file_name_for(corpus_doc.external_doc_id),
            content_type="text/plain",
        )
        result = files.register_upload(user, collection, spec, io.BytesIO(content.encode("utf-8")))
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
            external_id = external_id_from_name(document.name)
            if reached_the_index(document):
                indexed.add(external_id)
            else:
                failed.add(external_id)
        return indexed, failed
