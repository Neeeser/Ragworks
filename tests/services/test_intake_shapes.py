"""Intake shapes end to end: what actually reaches the index per file type.

The default text scaffold is exercised by `test_ingestion.py`; this module
covers the multimodal shape the wizard scaffolds — parse nodes fanned out
from the upload and merged into one embed/index chain — because the
question it answers ("did the PDF's figures get indexed?") cannot be
asked of a node in isolation.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.db import models
from app.db.models import DocumentStatus
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.schemas.enums import ProviderKind
from app.services import ingestion as ingestion_module
from app.services.errors import InvalidInputError
from app.services.files import FileSystemService, UploadSpec
from app.services.ingestion import IngestionService
from app.services.pipeline_resolution import resolve_ingest_binding
from app.services.pipelines import PipelineService
from tests.utils.collections import bind_scaffolds
from tests.utils.providers import TEST_EMBED_CONNECTION_ID, install_scaffolded_pipelines

ASSETS = Path(__file__).parent.parent / "assets"


class _StubEmbedder:
    """Embeds text and images alike, so the index sees both planes."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 3, "total_tokens": 3}

    def embed_documents(self, chunks):
        return [[0.1, 0.2, 0.3] for _ in chunks]

    def embed_query(self, _query: str):
        return [0.1, 0.2, 0.3]

    def embed_images(self, images):
        return [[0.4, 0.5, 0.6] for _ in images]


class _StubProviderResolver:
    """ProviderResolver stand-in whose model publishes text and image input."""

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _StubEmbedder(model_name)

    def embedding_input_limit(self, _connection_id, _model_name: str) -> int | None:
        return None

    def input_modalities(self, _connection_id, _model_name: str, _kind: ProviderKind):
        return frozenset({"text", "image"})


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="intake@example.com", full_name="Intake Tester", hashed_password="hashed"
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Intake", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _multimodal_definition() -> PipelineDefinition:
    """input -> {text, embedded media, media file} -> merge -> embed -> index."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="in", type="ingestion.input", name="Ingestion Input"),
            PipelineNodeDefinition(id="text", type="parse.text", name="Extract Text"),
            PipelineNodeDefinition(
                id="media", type="parse.embedded_media", name="Extract Media"
            ),
            PipelineNodeDefinition(id="file", type="parse.media_file", name="Media File"),
            PipelineNodeDefinition(
                id="chunk",
                type="chunker.token",
                name="Token Chunker",
                config={"chunk_size": 32, "chunk_overlap": 0},
            ),
            PipelineNodeDefinition(id="merge", type="merge.items", name="Merge Items"),
            PipelineNodeDefinition(
                id="embed",
                type="embedder.text",
                name="Embedder",
                config={
                    "connection_id": str(TEST_EMBED_CONNECTION_ID),
                    "model_name": "multimodal-embed",
                },
            ),
            PipelineNodeDefinition(
                id="index",
                type="indexer.vector",
                name="Indexer",
                config={
                    "backend": "pgvector",
                    "index_name": "ragworks",
                    "namespace": "col-{{collection_id}}",
                    "ensure_index": True,
                },
            ),
            PipelineNodeDefinition(id="out", type="ingestion.output", name="Ingestion Output"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="in", target="text", source_port="items", target_port="source"
            ),
            PipelineEdgeDefinition(
                id="e2", source="in", target="media", source_port="items", target_port="source"
            ),
            PipelineEdgeDefinition(
                id="e3", source="in", target="file", source_port="items", target_port="source"
            ),
            PipelineEdgeDefinition(
                id="e4", source="text", target="chunk", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e5", source="chunk", target="merge", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e6", source="media", target="merge", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e7", source="file", target="merge", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e8", source="merge", target="embed", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e9", source="embed", target="index", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e10", source="index", target="out", source_port="items", target_port="items"
            ),
        ],
    )


def _bind_multimodal(
    session: Session, user: models.User, collection: models.Collection
) -> None:
    pipelines = PipelineService(session)
    pipeline = pipelines.create_pipeline(
        user=user,
        name="Multimodal Intake",
        description="Fan-out intake merged into one chain.",
        definition=_multimodal_definition(),
    )
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.INGEST,
        )
    )
    session.commit()
    assert resolve_ingest_binding(session, user, collection) is not None


def _ingest(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    filename: str,
    content_type: str,
    content: bytes,
) -> models.Document:
    files = FileSystemService(session)
    result = files.register_upload(
        user,
        collection,
        UploadSpec(filename=filename, content_type=content_type),
        io.BytesIO(content),
    )
    # An image is not auto-ingested by default, so the run is forced the way
    # `POST /api/files/{id}/ingest` forces it.
    pending = result.document or files.ensure_pending_document(user, collection, result.file)
    IngestionService(session).ingest_document(
        user=user, collection=collection, document=pending
    )
    document = session.get(models.Document, pending.id)
    assert document is not None
    return document


def _chunks(session: Session, document: models.Document) -> list[models.DocumentChunkRecord]:
    return list(
        session.exec(
            select(models.DocumentChunkRecord).where(
                models.DocumentChunkRecord.document_id == document.id
            )
        ).all()
    )


def test_a_pdfs_figures_reach_the_index_through_the_media_branch(
    monkeypatch, pg_search_session: Session
) -> None:
    """The fan-out shape exists so one file can feed several planes."""
    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _bind_multimodal(session, user, collection)

    document = _ingest(
        session,
        user,
        collection,
        filename="images.pdf",
        content_type="application/pdf",
        content=(ASSETS / "images.pdf").read_bytes(),
    )

    assert document.status == DocumentStatus.READY
    records = _chunks(session, document)
    # The fixture's figure, pulled out of the PDF and embedded as an image.
    # (It carries no text layer, so Extract Text legitimately yields nothing.)
    assert [record.embedding for record in records] == [[0.4, 0.5, 0.6]]
    assert records[0].text.startswith("[image:")


def test_a_bare_image_is_indexed_through_the_media_file_branch(
    monkeypatch, pg_search_session: Session
) -> None:
    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _bind_multimodal(session, user, collection)

    document = _ingest(
        session,
        user,
        collection,
        filename="diagram.png",
        content_type="image/png",
        content=(ASSETS / "diagram.png").read_bytes(),
    )

    assert document.status == DocumentStatus.READY
    records = _chunks(session, document)
    assert [record.embedding for record in records] == [[0.4, 0.5, 0.6]]


def test_a_text_file_still_chunks_normally_through_the_same_shape(
    monkeypatch, pg_search_session: Session
) -> None:
    """Every branch but Extract Text produces nothing, and that is the point."""
    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _bind_multimodal(session, user, collection)

    document = _ingest(
        session,
        user,
        collection,
        filename="notes.txt",
        content_type="text/plain",
        content=b"Paris is the capital of France. It is known for the Eiffel Tower.",
    )

    assert document.status == DocumentStatus.READY
    records = _chunks(session, document)
    assert records
    assert all(record.embedding == [0.1, 0.2, 0.3] for record in records)
    assert all(record.text for record in records)


def test_a_file_no_parse_node_handles_records_the_document_unsupported(
    monkeypatch, pg_search_session: Session
) -> None:
    """Force-ingesting an image through a text-only pipeline is not success.

    Every parse node skipped the file, so the run indexed nothing — a
    `READY` document with zero chunks would claim the opposite.
    """
    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    # The text-only scaffold: the graph that declines an image is the point.
    collection = bind_scaffolds(session, user, _create_collection(session, user))

    files = FileSystemService(session)
    result = files.register_upload(
        user,
        collection,
        UploadSpec(filename="diagram.png", content_type="image/png"),
        io.BytesIO((ASSETS / "diagram.png").read_bytes()),
    )
    pending = result.document or files.ensure_pending_document(user, collection, result.file)

    with pytest.raises(InvalidInputError, match="image/png"):
        IngestionService(session).ingest_document(
            user=user, collection=collection, document=pending
        )

    document = session.get(models.Document, pending.id)
    assert document is not None
    # Not FAILED: the run did nothing wrong, and rerunning the same graph over
    # the same bytes reaches the same answer.
    assert document.status == DocumentStatus.UNSUPPORTED
    assert "image/png" in (document.error_message or "")
    assert _chunks(session, document) == []

    # The run mirrors the document: every node ran its contract, so the run
    # is UNSUPPORTED with the reason, never FAILED with all nodes completed.
    run = session.get(models.PipelineRun, document.ingestion_run_id)
    assert run is not None
    assert run.status == models.PipelineRunStatus.UNSUPPORTED
    assert "image/png" in (run.error_message or "")


def test_a_branch_that_skipped_a_file_another_handled_warns_nobody(
    monkeypatch, pg_search_session: Session
) -> None:
    """Per-branch skips in a fan-out stay in the trace, off the document."""
    session = pg_search_session
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _bind_multimodal(session, user, collection)

    document = _ingest(
        session,
        user,
        collection,
        filename="notes.txt",
        content_type="text/plain",
        content=b"Paris is the capital of France. It is known for the Eiffel Tower.",
    )

    assert document.status == DocumentStatus.READY
    assert document.warnings == []
