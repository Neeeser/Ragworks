from __future__ import annotations

import io

import pytest
from fastapi import UploadFile
from sqlmodel import Session, select

from app.db import models
from app.db.models import ChunkStrategy, DocumentStatus
from app.services import ingestion as ingestion_module
from app.services.ingestion import IngestionService


def _create_user(session: Session) -> models.User:
    user = models.User(email="unit@example.com", full_name="Unit Tester", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        embedding_model="embed",
        chat_model="chat",
        context_window=1024,
        chunk_size=128,
        chunk_overlap=8,
        chunk_strategy=ChunkStrategy.TOKEN,
        pinecone_index="idx",
        pinecone_namespace="ns",
        extra_metadata={"embedding_dimension": 128},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_ingest_upload_marks_document_failed_on_exception(monkeypatch, session, tmp_path) -> None:
    class _StubStorage:
        def __init__(self) -> None:
            self.base_path = tmp_path

        def save_upload(self, _upload: UploadFile, _relative_path: str):
            return tmp_path / "upload.txt"

    class _StubPinecone:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key

    class _FailingParser:
        def parse(self, _source: object) -> None:
            raise RuntimeError("parse failed")

    monkeypatch.setattr(ingestion_module, "FileStorage", _StubStorage)
    monkeypatch.setattr(ingestion_module, "Pinecone", _StubPinecone)
    monkeypatch.setattr(ingestion_module, "get_openrouter_client", lambda: object())

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = IngestionService(session)
    monkeypatch.setattr(service, "_select_parser", lambda _content_type: _FailingParser())

    upload = UploadFile(filename="doc.txt", file=io.BytesIO(b"content"))

    with pytest.raises(RuntimeError, match="parse failed"):
        service.ingest_upload(user=user, collection=collection, upload=upload)

    document = session.exec(select(models.Document)).first()
    assert document is not None
    assert document.status == DocumentStatus.FAILED

    event = session.exec(select(models.IngestionEvent)).first()
    assert event is not None
    assert event.event_type == "ingestion_failed"
    assert event.status == "error"
    assert "parse failed" in event.details["error"]
