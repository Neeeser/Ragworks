from __future__ import annotations

from typing import Iterable, Optional
from uuid import UUID

from sqlmodel import Session, select

from app.db import models


class UserRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_by_email(self, email: str) -> Optional[models.User]:
        statement = select(models.User).where(models.User.email == email)
        return self.session.exec(statement).first()

    def get(self, user_id: UUID) -> Optional[models.User]:
        return self.session.get(models.User, user_id)

    def add(self, user: models.User) -> models.User:
        self.session.add(user)
        self.session.flush()
        return user


class CollectionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_for_user(self, user_id: UUID) -> Iterable[models.Collection]:
        statement = select(models.Collection).where(models.Collection.user_id == user_id)
        return self.session.exec(statement).all()

    def get(self, collection_id: UUID, user_id: Optional[UUID] = None) -> Optional[models.Collection]:
        statement = select(models.Collection).where(models.Collection.id == collection_id)
        if user_id:
            statement = statement.where(models.Collection.user_id == user_id)
        return self.session.exec(statement).first()

    def add(self, collection: models.Collection) -> models.Collection:
        self.session.add(collection)
        self.session.flush()
        return collection


class DocumentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_for_collection(self, collection_id: UUID) -> Iterable[models.Document]:
        statement = select(models.Document).where(models.Document.collection_id == collection_id)
        return self.session.exec(statement).all()

    def add(self, document: models.Document) -> models.Document:
        self.session.add(document)
        self.session.flush()
        return document

    def get(self, document_id: UUID) -> Optional[models.Document]:
        return self.session.get(models.Document, document_id)


class ChunkRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_many(self, chunks: Iterable[models.DocumentChunkRecord]) -> None:
        self.session.add_all(list(chunks))
        self.session.flush()

    def list_for_document(self, document_id: UUID) -> Iterable[models.DocumentChunkRecord]:
        statement = select(models.DocumentChunkRecord).where(models.DocumentChunkRecord.document_id == document_id)
        return self.session.exec(statement).all()


class ChatRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_session(self, session_model: models.ChatSession) -> models.ChatSession:
        self.session.add(session_model)
        self.session.flush()
        return session_model

    def get_session(self, session_id: UUID, user_id: Optional[UUID] = None) -> Optional[models.ChatSession]:
        statement = select(models.ChatSession).where(models.ChatSession.id == session_id)
        if user_id:
            statement = statement.where(models.ChatSession.user_id == user_id)
        return self.session.exec(statement).first()

    def list_sessions(self, collection_id: UUID, user_id: UUID) -> Iterable[models.ChatSession]:
        statement = select(models.ChatSession).where(
            models.ChatSession.collection_id == collection_id,
            models.ChatSession.user_id == user_id,
        )
        return self.session.exec(statement).all()

    def add_message(self, message: models.ChatMessage) -> models.ChatMessage:
        self.session.add(message)
        self.session.flush()
        return message

    def list_messages(self, session_id: UUID, limit: int = 50) -> Iterable[models.ChatMessage]:
        statement = (
            select(models.ChatMessage)
            .where(models.ChatMessage.session_id == session_id)
            .order_by(models.ChatMessage.created_at.asc())
        )
        if limit:
            statement = statement.limit(limit)
        return self.session.exec(statement).all()


class QueryRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_event(self, event: models.QueryEvent) -> models.QueryEvent:
        self.session.add(event)
        self.session.flush()
        return event
