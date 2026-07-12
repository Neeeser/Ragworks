from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.models import ChunkStrategy, DocumentStatus
from app.db.repositories import (
    ChunkRepository,
    CollectionRepository,
    CollectionStatsRepository,
    DocumentRepository,
    PipelineRepository,
    PipelineRunRepository,
    PipelineVersionRepository,
    QueryRepository,
    UserRepository,
)


def _create_user(session: Session, email: str = "user@example.com") -> models.User:
    repo = UserRepository(session)
    user = models.User(email=email, full_name="Example User", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    repo = CollectionRepository(session)
    collection = models.Collection(
        user_id=user.id,
        name="Test Collection",
        description="Unit test",
        extra_metadata={},
    )
    repo.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_document(session: Session, user: models.User, collection: models.Collection) -> models.Document:
    repo = DocumentRepository(session)
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="example.txt",
        content_type="text/plain",
        status=DocumentStatus.PROCESSING,
        num_chunks=0,
        num_tokens=0,
        chunk_size=512,
        chunk_overlap=32,
        chunk_strategy=ChunkStrategy.TOKEN,
        embedding_model="qwen/qwen3-embedding-0.6b",
    )
    repo.add(document)
    session.commit()
    session.refresh(document)
    return document


def test_user_repository_roundtrip(session: Session) -> None:
    repo = UserRepository(session)
    user = models.User(email="roundtrip@example.com", full_name="Round Trip", hashed_password="hashed")
    repo.add(user)
    session.commit()

    fetched = repo.get(user.id)
    assert fetched is not None
    assert fetched.email == "roundtrip@example.com"
    assert repo.get_by_email("roundtrip@example.com") is not None


def test_collection_repository_lists_per_user(session: Session) -> None:
    user = _create_user(session)
    repo = CollectionRepository(session)
    created = _create_collection(session, user)

    listings = repo.list_for_user(user.id)
    assert len(listings) == 1
    assert listings[0].id == created.id


def test_document_and_chunk_repositories(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    document = _create_document(session, user, collection)

    doc_repo = DocumentRepository(session)
    assert len(list(doc_repo.list_for_collection(collection.id))) == 1

    chunk_repo = ChunkRepository(session)
    chunk_record = models.DocumentChunkRecord(
        document_id=document.id,
        collection_id=collection.id,
        chunk_index=0,
        text="Hello world chunk",
        embedding=[0.1, 0.2, 0.3],
        chunk_metadata={"source": "unit-test"},
        chunk_size=512,
        chunk_overlap=32,
        chunk_strategy=ChunkStrategy.TOKEN,
        embedding_model="qwen/qwen3-embedding-0.6b",
    )
    chunk_repo.add_many([chunk_record])
    session.commit()

    stored = list(chunk_repo.list_for_document(document.id))
    assert len(stored) == 1
    assert stored[0].chunk_metadata["source"] == "unit-test"
    assert stored[0].embedding_model == "qwen/qwen3-embedding-0.6b"


def test_collection_repository_get_filters_user(session: Session) -> None:
    user_a = _create_user(session)
    user_b = models.User(email="user-b@example.com", full_name="User B", hashed_password="hashed")
    UserRepository(session).add(user_b)
    session.commit()
    session.refresh(user_b)
    collection = _create_collection(session, user_a)

    repo = CollectionRepository(session)

    assert repo.get(collection.id)
    assert repo.get(collection.id, user_id=user_a.id)
    assert repo.get(collection.id, user_id=user_b.id) is None


def test_document_repository_get_by_id(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    document = _create_document(session, user, collection)

    repo = DocumentRepository(session)

    assert repo.get(document.id) is not None


def test_query_repository_add_event(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    repo = QueryRepository(session)
    event = models.QueryEvent(
        user_id=user.id,
        collection_id=collection.id,
        query_text="What is RAG?",
        model="unit-test",
        response_payload={"answer": "ok"},
    )

    repo.add_event(event)
    session.commit()
    session.refresh(event)

    assert event.id is not None


def test_collection_stats_for_empty_ids_returns_empty_map(session: Session) -> None:
    user = _create_user(session, "stats@example.com")

    stats = CollectionStatsRepository(session).stats_for(user.id, [])

    assert stats == {}


def test_pipeline_repositories_and_versions(session: Session) -> None:
    user = _create_user(session, "pipeline@example.com")
    other = _create_user(session, "other@example.com")
    pipeline_repo = PipelineRepository(session)
    version_repo = PipelineVersionRepository(session)

    pipeline = models.Pipeline(
        user_id=user.id,
        name="Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    pipeline_repo.add(pipeline)
    session.commit()

    version_repo.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition={},
            created_by=user.id,
        )
    )
    version_repo.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=2,
            definition={},
            created_by=user.id,
        )
    )
    session.commit()

    assert pipeline_repo.get(pipeline.id, user_id=user.id) is not None
    assert pipeline_repo.get(pipeline.id, user_id=other.id) is None
    assert list(pipeline_repo.list_for_user(user.id, kind=models.PipelineKind.INGESTION))
    assert version_repo.get_by_version(pipeline.id, 2) is not None
    versions = list(version_repo.list_for_pipeline(pipeline.id))
    assert versions[0].version == 2


def test_pipeline_run_repository_lists_nodes(session: Session) -> None:
    user = _create_user(session, "run@example.com")
    collection = _create_collection(session, user)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    node_run_a = models.PipelineNodeRun(
        run_id=run.id,
        node_id="a",
        node_type="type",
        node_name="Node A",
        sequence_index=1,
        status=models.PipelineRunStatus.COMPLETED,
    )
    node_run_b = models.PipelineNodeRun(
        run_id=run.id,
        node_id="b",
        node_type="type",
        node_name="Node B",
        sequence_index=0,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add_all([node_run_a, node_run_b])
    session.flush()
    io_record = models.PipelineNodeIO(
        run_id=run.id,
        node_run_id=node_run_a.id,
        node_id="a",
        io_type=models.PipelineIOType.INPUT,
        port="input",
        payload={},
    )
    session.add(io_record)
    session.commit()

    repo = PipelineRunRepository(session)
    assert repo.get(run.id, user_id=user.id) is not None
    runs = list(repo.list_node_runs(run.id))
    io_records = list(repo.list_node_io(run.id))

    assert [node.node_id for node in runs] == ["b", "a"]
    assert io_records[0].node_id == "a"
