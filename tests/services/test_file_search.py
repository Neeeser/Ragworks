"""Behavior of ``FileSearchService``: mode grouping and chunk→file mapping."""

from __future__ import annotations

import io

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk
from app.services import file_search as search_module
from app.services.file_search import FileSearchService
from app.services.files import FileSystemService, UploadSpec


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="search@example.com",
        full_name="Search Tester",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_search_groups_name_folder_and_content_matches(
    monkeypatch: pytest.MonkeyPatch, session: Session
) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)
    upload = files.register_upload(
        user,
        collection,
        UploadSpec(filename=None, content_type="text/plain",
                   relative_path="reports/report-q3.txt"),
        io.BytesIO(b"quarterly numbers"),
    )
    assert upload.document is not None
    document_id = upload.document.id

    class _StubRetrieval:
        def __init__(self, _session: Session) -> None:
            pass

        def query_collection(
            self, _user: object, _collection: object, query: str, top_k: int = 5
        ) -> CollectionQueryResponse:
            return CollectionQueryResponse(
                query=query,
                top_k=top_k,
                chunks=[
                    RetrievedChunk(
                        chunk_id=f"{document_id}:0",
                        document_id=str(document_id),
                        score=0.9,
                        text="quarterly numbers",
                        metadata={},
                    )
                ],
                usage={},
            )

    monkeypatch.setattr(search_module, "RetrievalService", _StubRetrieval)

    result = FileSearchService(session).search(user, collection, query="report")

    assert [node.name for node in result.folders] == ["reports"]
    assert [node.name for node in result.files] == ["report-q3.txt"]
    assert len(result.content) == 1
    assert result.content[0].file is not None
    assert result.content[0].file.name == "report-q3.txt"
    assert result.content[0].snippet == "quarterly numbers"


def test_search_respects_mode_filter(
    monkeypatch: pytest.MonkeyPatch, session: Session
) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    files = FileSystemService(session)
    files.create_folder(user, collection, name="report-folder", parent_id=None)

    def _explode(_session: Session) -> None:
        raise AssertionError("content mode must not run when not requested")

    monkeypatch.setattr(search_module, "RetrievalService", _explode)

    result = FileSearchService(session).search(
        user, collection, query="report", modes=frozenset({"folder"})
    )

    assert [node.name for node in result.folders] == ["report-folder"]
    assert result.files == []
    assert result.content == []
