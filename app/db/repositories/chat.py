"""Repository for chat sessions, messages, and session-collection links."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import asc, desc, exists
from sqlalchemy import delete as sa_delete
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository, user_scoped


class ChatRepository(Repository):
    """Data access helpers for chat sessions and messages."""

    def add_session(self, session_model: models.ChatSession) -> models.ChatSession:
        """Persist a new chat session and return it."""
        return self._add(session_model)

    def get_session(
        self,
        session_id: UUID,
        user_id: UUID | None = None,
    ) -> models.ChatSession | None:
        """Return a chat session by id, optionally scoped to a user."""
        statement = select(models.ChatSession).where(models.ChatSession.id == session_id)
        statement = user_scoped(statement, models.ChatSession, user_id)
        return self.session.exec(statement).first()

    def list_sessions(
        self,
        *,
        user_id: UUID,
        collection_ids: Sequence[UUID] | None = None,
        include_unassigned: bool = False,
    ) -> list[models.ChatSession]:
        """List chat sessions for a user, optionally filtered by tool collections."""
        base_statement = select(models.ChatSession).where(models.ChatSession.user_id == user_id)
        if not collection_ids and not include_unassigned:
            return list(self.session.exec(base_statement).all())

        session_ids: set[UUID] = set()
        if collection_ids:
            assoc_statement = (
                select(col(models.ChatSessionCollection.session_id))
                .join(
                    models.ChatSession,
                    col(models.ChatSession.id) == col(models.ChatSessionCollection.session_id),
                )
                .where(
                    col(models.ChatSession.user_id) == user_id,
                    col(models.ChatSessionCollection.collection_id).in_(collection_ids),
                )
            )
            session_ids.update(self.session.exec(assoc_statement).all())

        if include_unassigned:
            unassigned_statement = (
                select(col(models.ChatSession.id))
                .where(col(models.ChatSession.user_id) == user_id)
                .where(
                    ~exists().where(
                        col(models.ChatSessionCollection.session_id) == col(models.ChatSession.id)
                    )
                )
            )
            session_ids.update(self.session.exec(unassigned_statement).all())

        if not session_ids:
            return []
        filtered_statement = base_statement.where(col(models.ChatSession.id).in_(session_ids))
        return list(self.session.exec(filtered_statement).all())

    def list_session_collection_ids(self, session_id: UUID) -> list[UUID]:
        """List tool collection ids for a chat session."""
        statement = (
            select(col(models.ChatSessionCollection.collection_id))
            .where(col(models.ChatSessionCollection.session_id) == session_id)
            .order_by(asc(col(models.ChatSessionCollection.created_at)))
        )
        return list(self.session.exec(statement).all())

    def list_session_collection_ids_for_sessions(
        self,
        session_ids: Sequence[UUID],
    ) -> dict[UUID, list[UUID]]:
        """Return tool collection ids grouped by session."""
        if not session_ids:
            return {}
        statement = (
            select(
                col(models.ChatSessionCollection.session_id),
                col(models.ChatSessionCollection.collection_id),
            )
            .where(col(models.ChatSessionCollection.session_id).in_(session_ids))
            .order_by(asc(col(models.ChatSessionCollection.created_at)))
        )
        mapping: dict[UUID, list[UUID]] = {session_id: [] for session_id in session_ids}
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
        self.session.execute(
            sa_delete(models.ChatSessionCollection).where(
                col(models.ChatSessionCollection.session_id) == session_id
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
        return self._add(message)

    def get_message(
        self,
        message_id: UUID,
        user_id: UUID | None = None,
    ) -> models.ChatMessage | None:
        """Return a chat message by id, optionally scoped to a user."""
        statement = select(models.ChatMessage).where(models.ChatMessage.id == message_id)
        if user_id:
            statement = statement.join(
                models.ChatSession,
                col(models.ChatMessage.session_id) == col(models.ChatSession.id),
            )
            statement = user_scoped(statement, models.ChatSession, user_id)
        return self.session.exec(statement).first()

    def get_message_anchor(
        self,
        session_id: UUID,
        since: datetime,
    ) -> models.ChatMessage | None:
        """Return the first non-user message at or after the timestamp, if any."""
        statement = (
            select(models.ChatMessage)
            .where(
                col(models.ChatMessage.session_id) == session_id,
                col(models.ChatMessage.created_at) >= since,
                col(models.ChatMessage.role) != models.ChatRole.USER,
            )
            .order_by(asc(col(models.ChatMessage.created_at)))
            .limit(1)
        )
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
            col(models.ChatMessage.created_at) >= created_at
            if include_anchor
            else col(models.ChatMessage.created_at) > created_at
        )
        statement = sa_delete(models.ChatMessage).where(
            col(models.ChatMessage.session_id) == session_id,
            comparator,
        )
        self.session.execute(statement)
        self.session.flush()

    def get_last_user_message_before(
        self,
        session_id: UUID,
        timestamp: datetime,
    ) -> models.ChatMessage | None:
        """Return the last user message before a timestamp."""
        statement = (
            select(models.ChatMessage)
            .where(
                col(models.ChatMessage.session_id) == session_id,
                col(models.ChatMessage.role) == models.ChatRole.USER,
                col(models.ChatMessage.created_at) <= timestamp,
            )
            .order_by(desc(col(models.ChatMessage.created_at)))
            .limit(1)
        )
        return self.session.exec(statement).first()

    def delete_tool_messages_since(self, session_id: UUID, since: datetime) -> None:
        """Delete tool messages created after the given timestamp."""
        statement = sa_delete(models.ChatMessage).where(
            col(models.ChatMessage.session_id) == session_id,
            col(models.ChatMessage.role) == models.ChatRole.TOOL,
            col(models.ChatMessage.created_at) >= since,
        )
        self.session.execute(statement)
        self.session.flush()

    def list_messages(
        self,
        session_id: UUID,
        limit: int | None = 50,
    ) -> list[models.ChatMessage]:
        """List a session's messages oldest-first; a falsy limit returns them all."""
        statement = (
            select(models.ChatMessage)
            .where(col(models.ChatMessage.session_id) == session_id)
            .order_by(asc(col(models.ChatMessage.created_at)))
        )
        if limit:
            statement = statement.limit(limit)
        return list(self.session.exec(statement).all())

    def delete_session(self, session_model: models.ChatSession) -> None:
        """Delete a session and its associated messages."""
        self.session.execute(
            sa_delete(models.ChatSessionCollection).where(
                col(models.ChatSessionCollection.session_id) == session_model.id,
            )
        )
        self.session.execute(
            sa_delete(models.ChatMessage).where(
                col(models.ChatMessage.session_id) == session_model.id,
            )
        )
        self.session.delete(session_model)
        self.session.flush()
