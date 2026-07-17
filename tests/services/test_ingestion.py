"""Behavior of ``IngestionService`` (happy path, retries, failures).

Ingestion runs against a document row created by
`FileSystemService.register_upload` / `ensure_pending_document`; these tests
drive that same public path. The failure tests pin the honest-failure
contract: the uploaded *file* always persists, and the document row lands
`FAILED` with a descriptive `error_message` — never a "ready" row with zero
chunks (the pre-file-tree behavior this feature replaced).
"""

from __future__ import annotations

import io
from contextlib import contextmanager
from copy import deepcopy

import pytest
from pinecone.exceptions import PineconeException
from sqlmodel import Session, select

from app.db import models
from app.db.models import DocumentStatus
from app.pipelines.defaults import build_default_retrieval_pipeline
from app.services import ingestion as ingestion_module
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.files import FileSystemService, UploadSpec
from app.services.ingestion import IngestionService
from app.services.pipeline_resolution import resolve_ingestion_pipeline
from app.services.pipelines import PipelineService
from app.vectorstores.pgvector import PgvectorStore
from app.vectorstores.registry import VectorStoreProvider
from tests.utils.providers import TEST_EMBED_CONNECTION_ID, install_default_pipelines


class _StubEmbedder:
    """Embedder stand-in returning fixed 3-dimension vectors."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 3, "total_tokens": 3}

    def embed_documents(self, chunks):
        return [[0.1, 0.2, 0.3] for _ in chunks]

    def embed_query(self, _query: str):
        return [0.1, 0.2, 0.3]


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _StubEmbedder(model_name)

    def embedding_input_limit(self, _connection_id, _model_name: str) -> int | None:
        return None


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="unit@example.com",
        full_name="Unit Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _create_collection(
    session: Session, user: models.User, **overrides: object
) -> models.Collection:
    defaults: dict[str, object] = {
        "user_id": user.id,
        "name": "Collection",
        "description": "",
        "extra_metadata": {},
    }
    defaults.update(overrides)
    collection = models.Collection(**defaults)  # type: ignore[arg-type]
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _upload_pending_document(
    session: Session,
    user: models.User,
    collection: models.Collection,
    content: bytes = b"content",
) -> tuple[models.FileNode, models.Document]:
    """Register a text upload and return its file node + pending document."""
    result = FileSystemService(session).register_upload(
        user,
        collection,
        UploadSpec(filename="doc.txt", content_type="text/plain"),
        io.BytesIO(content),
    )
    assert result.document is not None
    return result.file, result.document


def test_ingest_document_happy_path_persists_chunks_and_marks_ready(
    monkeypatch, pg_search_session: Session
) -> None:
    """A successful ingest embeds, indexes into the default pgvector backend,
    and persists chunks; the document ends `READY` with a chunk count matching
    what's actually in the DB."""
    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)

    user = _create_user(session)
    collection = _create_collection(session, user)
    content = b"Paris is the capital of France. It is known for the Eiffel Tower."
    _file, document = _upload_pending_document(session, user, collection, content)

    IngestionService(session).ingest_document(user=user, collection=collection, document=document)

    refreshed = session.get(models.Document, document.id)
    assert refreshed is not None
    assert refreshed.status == DocumentStatus.READY
    assert refreshed.error_message is None
    assert refreshed.num_chunks > 0

    chunk_records = session.exec(
        select(models.DocumentChunkRecord).where(
            models.DocumentChunkRecord.document_id == document.id
        )
    ).all()
    assert len(chunk_records) == refreshed.num_chunks
    assert all(record.embedding == [0.1, 0.2, 0.3] for record in chunk_records)
    assert all(record.text for record in chunk_records)
    assert all(record.token_count > 0 for record in chunk_records)

    # The indexer actually upserted the chunks into the pgvector index.
    store = PgvectorStore(session)
    assert store.describe_index("ragworks").dimension == 3
    indexed = store.query(
        "ragworks",
        f"col-{collection.id}",
        embedding=[0.1, 0.2, 0.3],
        top_k=50,
    )
    assert len(indexed.matches) == refreshed.num_chunks

    event = session.exec(select(models.IngestionEvent)).first()
    assert event is not None
    assert event.event_type == "ingestion_complete"
    assert event.status == "success"
    assert event.details["chunks"] == refreshed.num_chunks


def test_oversized_chunk_is_split_with_ready_document_and_persisted_warnings(
    monkeypatch, pg_search_session: Session
) -> None:
    """The runtime guard preserves all text, trace warnings, and deletable vector ids."""

    class _LimitedProviderResolver(_StubProviderResolver):
        def embedding_input_limit(self, _connection_id, _model_name: str) -> int | None:
            return 56

    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _LimitedProviderResolver)
    user = _create_user(session)

    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.kind == models.PipelineKind.INGESTION,
            models.Pipeline.is_default.is_(True),
        )
    ).one()
    version = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline.id,
            models.PipelineVersion.version == pipeline.current_version,
        )
    ).one()
    definition = deepcopy(version.definition)
    for node in definition["nodes"]:
        if str(node["type"]).startswith("chunker."):
            node["config"] = {
                **node.get("config", {}),
                "chunk_size": 100,
                "chunk_overlap": 0,
                "tokenizer": "whitespace",
            }
    version.definition = definition
    session.add(version)
    session.commit()

    collection = _create_collection(session, user)
    original_tokens = [f"token-{index}" for index in range(160)]
    _file_node, document = _upload_pending_document(
        session,
        user,
        collection,
        " ".join(original_tokens).encode(),
    )

    IngestionService(session).ingest_document(
        user=user,
        collection=collection,
        document=document,
    )

    document_id = document.id
    run_id = document.ingestion_run_id
    assert run_id is not None
    namespace = f"col-{collection.id}"
    bind = session.get_bind()
    session.close()

    with Session(bind) as fresh_session:
        fresh_document = fresh_session.get(models.Document, document_id)
        assert fresh_document is not None
        assert fresh_document.status == DocumentStatus.READY
        assert fresh_document.warnings

        run = fresh_session.get(models.PipelineRun, run_id)
        assert run is not None
        assert run.status == models.PipelineRunStatus.COMPLETED
        assert run.warnings == fresh_document.warnings

        chunks = fresh_session.exec(
            select(models.DocumentChunkRecord)
            .where(models.DocumentChunkRecord.document_id == document_id)
            .order_by(models.DocumentChunkRecord.chunk_index)
        ).all()
        assert len(chunks) > 1
        assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
        assert all(len(chunk.text.split()) <= 40 for chunk in chunks)
        assert set(original_tokens).issubset(
            {token for chunk in chunks for token in chunk.text.split()}
        )

        store = PgvectorStore(fresh_session)
        indexed = store.query(
            "ragworks",
            namespace,
            embedding=[0.1, 0.2, 0.3],
            top_k=100,
        )
        assert {match.chunk.chunk_id for match in indexed.matches} == {
            f"{document_id}:{order}" for order in range(len(chunks))
        }

        sparse = store.lexical_query(
            "ragworks-bm25",
            namespace,
            text=" ".join(original_tokens),
            top_k=100,
        )
        assert {match.chunk.chunk_id: match.chunk.text for match in sparse.matches} == {
            f"{document_id}:{chunk.chunk_index}": chunk.text for chunk in chunks
        }

        fresh_collection = fresh_session.get(models.Collection, fresh_document.collection_id)
        assert fresh_collection is not None
        resolved = resolve_ingestion_pipeline(fresh_session, user, fresh_collection)
        IngestionService._purge_previous_vectors(
            VectorStoreProvider(
                user=user,
                session=fresh_session,
            ),
            resolved,
            fresh_document,
        )
        fresh_session.commit()
        assert (
            store.query(
                "ragworks",
                namespace,
                embedding=[0.1, 0.2, 0.3],
                top_k=50,
            ).matches
            == []
        )
        assert (
            store.lexical_query("ragworks-bm25", namespace, text="token-1", top_k=50).matches == []
        )


def test_background_ingestion_persists_pipeline_warnings_in_its_own_session(
    monkeypatch, pgvector_session: Session
) -> None:
    """The background entry point commits completion warnings before returning."""

    class _LimitedProviderResolver(_StubProviderResolver):
        def embedding_input_limit(self, _connection_id, _model_name: str) -> int | None:
            return 56

    session = pgvector_session
    bind = session.get_bind()
    monkeypatch.setattr("app.pipelines.defaults.lexical_available", lambda _backend: False)
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _LimitedProviderResolver)

    @contextmanager
    def isolated_session():
        with Session(bind) as background_session:
            yield background_session

    monkeypatch.setattr(ingestion_module, "session_scope", isolated_session)
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.kind == models.PipelineKind.INGESTION,
            models.Pipeline.is_default.is_(True),
        )
    ).one()
    version = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline.id,
            models.PipelineVersion.version == pipeline.current_version,
        )
    ).one()
    definition = deepcopy(version.definition)
    for node in definition["nodes"]:
        if str(node["type"]).startswith("chunker."):
            node["config"] = {
                **node.get("config", {}),
                "chunk_size": 100,
                "chunk_overlap": 0,
                "tokenizer": "whitespace",
            }
    version.definition = definition
    session.add(version)
    session.commit()
    _file_node, document = _upload_pending_document(
        session, user, collection, " ".join(f"token-{i}" for i in range(80)).encode()
    )

    ingestion_module.run_document_ingestion(document.id)

    with Session(bind) as fresh:
        persisted = fresh.get(models.Document, document.id)
        assert persisted is not None
        assert persisted.status == DocumentStatus.READY
        assert persisted.warnings
        run = fresh.get(models.PipelineRun, persisted.ingestion_run_id)
        assert run is not None
        assert run.warnings == persisted.warnings


def test_failed_ingestion_keeps_file_and_records_descriptive_error(
    monkeypatch, session: Session
) -> None:
    """The honest-failure regression: a pipeline failure leaves the uploaded
    file in the tree and marks the document `FAILED` with the failure's
    message — no ready-with-zero-chunks ghost, no vanished upload."""

    class _FailingExecutor:
        def __init__(self, _registry: object) -> None:
            self.registry = _registry

        def execute(self, _definition: object, _context: object) -> None:
            raise RuntimeError("parse failed")

    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _FailingExecutor)

    user = _create_user(session)
    collection = _create_collection(session, user)
    file_node, document = _upload_pending_document(session, user, collection)

    with pytest.raises(RuntimeError, match="parse failed"):
        IngestionService(session).ingest_document(
            user=user, collection=collection, document=document
        )

    refreshed = session.get(models.Document, document.id)
    assert refreshed is not None
    assert refreshed.status == DocumentStatus.FAILED
    assert refreshed.error_message == "parse failed"
    assert refreshed.num_chunks == 0

    # The file itself survives the failure and still lists in the tree.
    tree = FileSystemService(session).tree(collection)
    listed = {node.id: node for node in tree.nodes}
    assert file_node.id in listed
    assert listed[file_node.id].ingestion is not None
    assert listed[file_node.id].ingestion.status == DocumentStatus.FAILED
    assert listed[file_node.id].ingestion.error_message == "parse failed"

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "parse failed"

    event = session.exec(select(models.IngestionEvent)).first()
    assert event is not None
    assert event.event_type == "ingestion_failed"
    assert event.status == "error"
    assert "parse failed" in event.details["error"]


def test_retry_after_failure_resets_the_same_document_row(monkeypatch, session: Session) -> None:
    """Re-queueing a failed file reuses its document row: status back to
    `pending`, error cleared — the X-badge retry path."""

    class _FailingExecutor:
        def __init__(self, _registry: object) -> None:
            self.registry = _registry

        def execute(self, _definition: object, _context: object) -> None:
            raise RuntimeError("parse failed")

    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _FailingExecutor)

    user = _create_user(session)
    collection = _create_collection(session, user)
    file_node, document = _upload_pending_document(session, user, collection)
    with pytest.raises(RuntimeError):
        IngestionService(session).ingest_document(
            user=user, collection=collection, document=document
        )

    retried = FileSystemService(session).ensure_pending_document(user, collection, file_node)
    session.commit()

    assert retried.id == document.id
    assert retried.status == DocumentStatus.PENDING
    assert retried.error_message is None


def test_ingest_document_wraps_pinecone_outage_as_external_service_error(
    monkeypatch, session: Session
) -> None:
    """A Pinecone outage mid-ingest must surface as a 502-mapped
    `ExternalServiceError`, not the raw SDK exception -- while still marking
    the document and run FAILED, same as any other pipeline failure."""

    class _FailingExecutor:
        def __init__(self, _registry: object) -> None:
            self.registry = _registry

        def execute(self, _definition: object, _context: object) -> None:
            raise PineconeException("Pinecone is unavailable")

    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _FailingExecutor)

    user = _create_user(session)
    collection = _create_collection(session, user)
    _file, document = _upload_pending_document(session, user, collection)

    with pytest.raises(ExternalServiceError, match="Pinecone is unavailable"):
        IngestionService(session).ingest_document(
            user=user, collection=collection, document=document
        )

    refreshed = session.get(models.Document, document.id)
    assert refreshed is not None
    assert refreshed.status == DocumentStatus.FAILED
    assert refreshed.error_message is not None

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_resolve_ingestion_pipeline_rejects_missing(session: Session) -> None:
    """`resolve_ingestion_pipeline` (app/services/pipeline_resolution.py) rejects
    a collection pointing at a retrieval pipeline instead of an ingestion one.

    This used to be `IngestionService._resolve_ingestion_pipeline`; the check
    moved to the shared resolver both `IngestionService` and `RetrievalService`
    call through.
    """
    user = _create_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()
    collection = _create_collection(session, user, ingestion_pipeline_id=pipeline.id)

    with pytest.raises(InvalidInputError, match="Ingestion pipeline could not be resolved"):
        resolve_ingestion_pipeline(session, user, collection)


def test_extract_indexing_payload_raises_for_missing_result() -> None:
    """Pure-function edge case: a malformed pipeline result payload raises a
    typed domain error rather than a raw `KeyError`/`ValidationError`. Kept as
    a direct test of the static method -- it's pure data-in/data-out logic,
    not wiring, and the malformed-payload shape isn't reachable through the
    public `ingest_document` path with any real pipeline definition."""
    with pytest.raises(InvalidInputError, match="ingestion result payload"):
        IngestionService._extract_indexing_payload({"node": {"data": {}}})
