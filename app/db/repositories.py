"""Repository helpers for database access."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import asc, delete as sa_delete, desc, exists
from sqlmodel import Session, select

from app.db import models


class UserRepository:
    """Data access helpers for users."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def get_by_email(self, email: str) -> Optional[models.User]:
        """Return a user by email if one exists."""
        statement = select(models.User).where(models.User.email == email)
        return self.session.exec(statement).first()

    def get(self, user_id: UUID) -> Optional[models.User]:
        """Return a user by id if one exists."""
        return self.session.get(models.User, user_id)

    def add(self, user: models.User) -> models.User:
        """Persist a new user and return it."""
        self.session.add(user)
        self.session.flush()
        return user


class CollectionRepository:
    """Data access helpers for collections."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def list_for_user(self, user_id: UUID) -> Iterable[models.Collection]:
        """List collections belonging to a user."""
        statement = select(models.Collection).where(
            models.Collection.user_id == user_id,
        )
        return self.session.exec(statement).all()

    def get(
        self,
        collection_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[models.Collection]:
        """Return a collection by id, optionally scoped to a user."""
        statement = select(models.Collection).where(models.Collection.id == collection_id)
        if user_id:
            statement = statement.where(models.Collection.user_id == user_id)
        return self.session.exec(statement).first()

    def add(self, collection: models.Collection) -> models.Collection:
        """Persist a new collection and return it."""
        self.session.add(collection)
        self.session.flush()
        return collection


class DocumentRepository:
    """Data access helpers for documents."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def list_for_collection(self, collection_id: UUID) -> Iterable[models.Document]:
        """List documents in a collection."""
        statement = select(models.Document).where(
            models.Document.collection_id == collection_id,
        )
        return self.session.exec(statement).all()

    def add(self, document: models.Document) -> models.Document:
        """Persist a new document and return it."""
        self.session.add(document)
        self.session.flush()
        return document

    def get(self, document_id: UUID) -> Optional[models.Document]:
        """Return a document by id if one exists."""
        return self.session.get(models.Document, document_id)


class ChunkRepository:
    """Data access helpers for document chunks."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def add_many(self, chunks: Iterable[models.DocumentChunkRecord]) -> None:
        """Persist multiple chunk records."""
        self.session.add_all(list(chunks))
        self.session.flush()

    def list_for_document(self, document_id: UUID) -> Iterable[models.DocumentChunkRecord]:
        """List chunks belonging to a document."""
        statement = select(models.DocumentChunkRecord).where(
            models.DocumentChunkRecord.document_id == document_id,
        )
        return self.session.exec(statement).all()


class ChatRepository:
    """Data access helpers for chat sessions and messages."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def add_session(self, session_model: models.ChatSession) -> models.ChatSession:
        """Persist a new chat session and return it."""
        self.session.add(session_model)
        self.session.flush()
        return session_model

    def get_session(
        self,
        session_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[models.ChatSession]:
        """Return a chat session by id, optionally scoped to a user."""
        statement = select(models.ChatSession).where(models.ChatSession.id == session_id)
        if user_id:
            statement = statement.where(models.ChatSession.user_id == user_id)
        return self.session.exec(statement).first()

    def list_sessions(
        self,
        *,
        user_id: UUID,
        collection_ids: Optional[Sequence[UUID]] = None,
        include_unassigned: bool = False,
    ) -> Iterable[models.ChatSession]:
        """List chat sessions for a user, optionally filtered by tool collections."""
        base_statement = select(models.ChatSession).where(models.ChatSession.user_id == user_id)
        if not collection_ids and not include_unassigned:
            return self.session.exec(base_statement).all()

        session_ids: set[UUID] = set()
        if collection_ids:
            assoc_statement = (
                select(models.ChatSessionCollection.session_id)
                .join(
                    models.ChatSession,
                    models.ChatSession.id == models.ChatSessionCollection.session_id,
                )
                .where(
                    models.ChatSession.user_id == user_id,
                    models.ChatSessionCollection.collection_id.in_(collection_ids),  # pylint: disable=no-member
                )
            )
            session_ids.update(self.session.exec(assoc_statement).all())

        if include_unassigned:
            unassigned_statement = (
                select(models.ChatSession.id)
                .where(models.ChatSession.user_id == user_id)
                .where(
                    ~exists().where(
                        models.ChatSessionCollection.session_id == models.ChatSession.id
                    )
                )
            )
            session_ids.update(self.session.exec(unassigned_statement).all())

        if not session_ids:
            return []
        filtered_statement = base_statement.where(
            models.ChatSession.id.in_(session_ids)  # pylint: disable=no-member
        )
        return self.session.exec(filtered_statement).all()

    def list_session_collection_ids(self, session_id: UUID) -> List[UUID]:
        """List tool collection ids for a chat session."""
        statement = (
            select(models.ChatSessionCollection.collection_id)
            .where(models.ChatSessionCollection.session_id == session_id)
            .order_by(asc(models.ChatSessionCollection.created_at))
        )
        return list(self.session.exec(statement).all())

    def list_session_collection_ids_for_sessions(
        self,
        session_ids: Sequence[UUID],
    ) -> dict[UUID, List[UUID]]:
        """Return tool collection ids grouped by session."""
        if not session_ids:
            return {}
        statement = (
            select(
                models.ChatSessionCollection.session_id,
                models.ChatSessionCollection.collection_id,
            )
            .where(models.ChatSessionCollection.session_id.in_(session_ids))  # pylint: disable=no-member
            .order_by(asc(models.ChatSessionCollection.created_at))
        )
        mapping: dict[UUID, List[UUID]] = {session_id: [] for session_id in session_ids}
        for session_id, collection_id in self.session.exec(statement).all():
            mapping.setdefault(session_id, []).append(collection_id)
        return mapping

    def replace_session_collections(
        self,
        *,
        session_id: UUID,
        collection_ids: Sequence[UUID],
    ) -> None:
        """Replace tool collection associations for a session."""
        self.session.exec(
            sa_delete(models.ChatSessionCollection).where(
                models.ChatSessionCollection.session_id == session_id
            )
        )
        if collection_ids:
            associations = [
                models.ChatSessionCollection(session_id=session_id, collection_id=collection_id)
                for collection_id in collection_ids
            ]
            self.session.add_all(associations)
        self.session.flush()

    def add_message(self, message: models.ChatMessage) -> models.ChatMessage:
        """Persist a chat message and return it."""
        self.session.add(message)
        self.session.flush()
        return message

    def get_message(
        self,
        message_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[models.ChatMessage]:
        """Return a chat message by id, optionally scoped to a user."""
        statement = select(models.ChatMessage).where(models.ChatMessage.id == message_id)
        if user_id:
            statement = statement.join(
                models.ChatSession,
                models.ChatMessage.session_id == models.ChatSession.id,
            ).where(models.ChatSession.user_id == user_id)
        return self.session.exec(statement).first()

    def delete_messages_after(
        self,
        session_id: UUID,
        created_at: datetime,
        *,
        include_anchor: bool = False,
    ) -> None:
        """Delete messages created after a timestamp."""
        comparator = (
            models.ChatMessage.created_at >= created_at
            if include_anchor
            else models.ChatMessage.created_at > created_at
        )
        statement = sa_delete(models.ChatMessage).where(
            models.ChatMessage.session_id == session_id,
            comparator,
        )
        self.session.exec(statement)
        self.session.flush()

    def get_last_user_message_before(
        self,
        session_id: UUID,
        timestamp: datetime,
    ) -> Optional[models.ChatMessage]:
        """Return the last user message before a timestamp."""
        statement = (
            select(models.ChatMessage)
            .where(
                models.ChatMessage.session_id == session_id,
                models.ChatMessage.role == models.ChatRole.USER,
                models.ChatMessage.created_at <= timestamp,
            )
            .order_by(desc(models.ChatMessage.created_at))
            .limit(1)
        )
        return self.session.exec(statement).first()

    def delete_tool_messages_since(self, session_id: UUID, since: datetime) -> None:
        """Delete tool messages created after the given timestamp."""
        statement = sa_delete(models.ChatMessage).where(
            models.ChatMessage.session_id == session_id,
            models.ChatMessage.role == models.ChatRole.TOOL,
            models.ChatMessage.created_at >= since,
        )
        self.session.exec(statement)
        self.session.flush()

    def list_messages(self, session_id: UUID, limit: int = 50) -> Iterable[models.ChatMessage]:
        """List messages for a chat session with an optional limit."""
        statement = (
            select(models.ChatMessage)
            .where(models.ChatMessage.session_id == session_id)
            .order_by(asc(models.ChatMessage.created_at))
        )
        if limit:
            statement = statement.limit(limit)
        return self.session.exec(statement).all()

    def list_all_messages(self, session_id: UUID) -> Iterable[models.ChatMessage]:
        """List all messages for a chat session."""
        statement = (
            select(models.ChatMessage)
            .where(models.ChatMessage.session_id == session_id)
            .order_by(asc(models.ChatMessage.created_at))
        )
        return self.session.exec(statement).all()

    def delete_session(self, session_model: models.ChatSession) -> None:
        """Delete a session and its associated messages."""
        self.session.exec(
            sa_delete(models.ChatSessionCollection).where(
                models.ChatSessionCollection.session_id == session_model.id,
            )
        )
        self.session.exec(
            sa_delete(models.ChatMessage).where(
                models.ChatMessage.session_id == session_model.id,
            )
        )
        self.session.delete(session_model)
        self.session.flush()


class QueryRepository:  # pylint: disable=too-few-public-methods
    """Data access helpers for query events."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def add_event(self, event: models.QueryEvent) -> models.QueryEvent:
        """Persist a query event and return it."""
        self.session.add(event)
        self.session.flush()
        return event


class PipelineRunRepository:  # pylint: disable=too-few-public-methods
    """Data access helpers for pipeline trace runs."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def get(self, run_id: UUID, user_id: Optional[UUID] = None) -> Optional[models.PipelineRun]:
        """Return a pipeline run by id, optionally scoped to a user."""
        statement = select(models.PipelineRun).where(models.PipelineRun.id == run_id)
        if user_id:
            statement = statement.where(models.PipelineRun.user_id == user_id)
        return self.session.exec(statement).first()

    def list_node_runs(self, run_id: UUID) -> Iterable[models.PipelineNodeRun]:
        """List node run records for a pipeline run."""
        statement = (
            select(models.PipelineNodeRun)
            .where(models.PipelineNodeRun.run_id == run_id)
            .order_by(asc(models.PipelineNodeRun.sequence_index))
        )
        return self.session.exec(statement).all()

    def list_node_io(self, run_id: UUID) -> Iterable[models.PipelineNodeIO]:
        """List node input/output records for a pipeline run."""
        statement = (
            select(models.PipelineNodeIO)
            .where(models.PipelineNodeIO.run_id == run_id)
            .order_by(asc(models.PipelineNodeIO.created_at))
        )
        return self.session.exec(statement).all()


class PipelineRepository:
    """Data access helpers for pipelines."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def list_for_user(
        self,
        user_id: UUID,
        *,
        kind: Optional[models.PipelineKind] = None,
    ) -> Iterable[models.Pipeline]:
        """List pipelines for a user, optionally filtered by kind."""
        statement = select(models.Pipeline).where(models.Pipeline.user_id == user_id)
        if kind:
            statement = statement.where(models.Pipeline.kind == kind)
        return self.session.exec(statement).all()

    def get(
        self,
        pipeline_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> Optional[models.Pipeline]:
        """Return a pipeline by id, optionally scoped to a user."""
        statement = select(models.Pipeline).where(models.Pipeline.id == pipeline_id)
        if user_id:
            statement = statement.where(models.Pipeline.user_id == user_id)
        return self.session.exec(statement).first()

    def get_default(
        self,
        user_id: UUID,
        kind: models.PipelineKind,
    ) -> Optional[models.Pipeline]:
        """Return the default pipeline for a user and kind."""
        statement = select(models.Pipeline).where(
            models.Pipeline.user_id == user_id,
            models.Pipeline.kind == kind,
            models.Pipeline.is_default.is_(True),  # pylint: disable=no-member
        )
        return self.session.exec(statement).first()

    def add(self, pipeline: models.Pipeline) -> models.Pipeline:
        """Persist a new pipeline and return it."""
        self.session.add(pipeline)
        self.session.flush()
        return pipeline


class PipelineVersionRepository:
    """Data access helpers for pipeline versions."""

    def __init__(self, session: Session) -> None:
        """Initialize the repository with a database session."""
        self.session = session

    def list_for_pipeline(self, pipeline_id: UUID) -> Iterable[models.PipelineVersion]:
        """List versions for a pipeline in descending order."""
        statement = (
            select(models.PipelineVersion)
            .where(models.PipelineVersion.pipeline_id == pipeline_id)
            .order_by(desc(models.PipelineVersion.version))
        )
        return self.session.exec(statement).all()

    def get_by_version(
        self,
        pipeline_id: UUID,
        version: int,
    ) -> Optional[models.PipelineVersion]:
        """Return a specific version for a pipeline."""
        statement = select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline_id,
            models.PipelineVersion.version == version,
        )
        return self.session.exec(statement).first()

    def add(self, version: models.PipelineVersion) -> models.PipelineVersion:
        """Persist a pipeline version and return it."""
        self.session.add(version)
        self.session.flush()
        return version
