from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    ChatRepository,
    PipelineRepository,
    PipelineRunRepository,
    PipelineVersionRepository,
)


def _create_user(session: Session, email: str) -> models.User:
    user = models.User(email=email, full_name="User", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_session(session: Session, user: models.User, collection: models.Collection) -> models.ChatSession:
    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id,
        title="Chat",
        mode=models.ChatMode.CHAT,
        chat_model="model",
        context_tokens=0,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    return chat_session


def test_chat_repository_message_queries(session: Session) -> None:
    user = _create_user(session, "chat@example.com")
    other = _create_user(session, "other@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)

    repo = ChatRepository(session)
    timestamp = datetime.now(timezone.utc)
    message = models.ChatMessage(
        session_id=chat_session.id,
        role=models.ChatRole.USER,
        content="hello",
        created_at=timestamp,
    )
    repo.add_message(message)
    session.commit()

    assert repo.get_message(message.id, user_id=user.id) is not None
    assert repo.get_message(message.id, user_id=other.id) is None

    last = repo.get_last_user_message_before(chat_session.id, timestamp + timedelta(seconds=1))
    assert last is not None
    assert last.id == message.id


def test_repository_getters_without_user_id(session: Session) -> None:
    user = _create_user(session, "no-filter@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    chat_repo = ChatRepository(session)
    message = models.ChatMessage(
        session_id=chat_session.id,
        role=models.ChatRole.USER,
        content="hello",
    )
    chat_repo.add_message(message)
    session.commit()

    assert chat_repo.get_message(message.id) is not None

    pipeline = models.Pipeline(
        user_id=user.id,
        name="Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.commit()

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

    run_repo = PipelineRunRepository(session)
    assert run_repo.get(run.id) is not None

    pipeline_repo = PipelineRepository(session)
    assert pipeline_repo.get(pipeline.id) is not None


def test_chat_repository_delete_messages_after(session: Session) -> None:
    user = _create_user(session, "delete@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)

    repo = ChatRepository(session)
    anchor_time = datetime.now(timezone.utc)
    repo.add_message(
        models.ChatMessage(
            session_id=chat_session.id,
            role=models.ChatRole.USER,
            content="first",
            created_at=anchor_time,
        )
    )
    repo.add_message(
        models.ChatMessage(
            session_id=chat_session.id,
            role=models.ChatRole.USER,
            content="second",
            created_at=anchor_time + timedelta(seconds=1),
        )
    )
    session.commit()

    repo.delete_messages_after(chat_session.id, anchor_time, include_anchor=True)
    session.commit()

    remaining = list(repo.list_messages(chat_session.id))
    assert remaining == []


def test_chat_repository_delete_tool_messages_since(session: Session) -> None:
    user = _create_user(session, "tools@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    repo = ChatRepository(session)

    cutoff = datetime.now(timezone.utc)
    repo.add_message(
        models.ChatMessage(
            session_id=chat_session.id,
            role=models.ChatRole.TOOL,
            content="tool",
            created_at=cutoff + timedelta(seconds=1),
        )
    )
    repo.add_message(
        models.ChatMessage(
            session_id=chat_session.id,
            role=models.ChatRole.USER,
            content="user",
            created_at=cutoff + timedelta(seconds=1),
        )
    )
    session.commit()

    repo.delete_tool_messages_since(chat_session.id, cutoff)
    session.commit()

    remaining = list(repo.list_messages(chat_session.id))
    assert len(remaining) == 1
    assert remaining[0].role == models.ChatRole.USER


def test_chat_repository_list_messages_limit_and_delete_session(session: Session) -> None:
    user = _create_user(session, "limit@example.com")
    collection = _create_collection(session, user)
    chat_session = _create_session(session, user, collection)
    repo = ChatRepository(session)

    for i in range(3):
        repo.add_message(
            models.ChatMessage(
                session_id=chat_session.id,
                role=models.ChatRole.USER,
                content=f"msg-{i}",
            )
        )
    session.commit()

    limited = list(repo.list_messages(chat_session.id, limit=2))
    assert len(limited) == 2

    repo.delete_session(chat_session)
    session.commit()

    remaining = list(repo.list_messages(chat_session.id))
    assert remaining == []


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
