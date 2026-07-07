"""Shared fixtures and provider/pipeline stubs for the chat test suite.

These consolidate the per-file `_create_user` / `_create_collection` /
`_stub_pipeline_helpers` builders that used to be copy-pasted across the chat
service tests. Provider and pipeline collaborators are patched at their real
boundaries: `get_settings` / `get_openrouter_client` / `RetrievalService` live
in `app.chat.service`, while `resolve_ingestion_pipeline` /
`resolve_retrieval_pipeline` (the consolidated resolver in
`app.services.pipeline_resolution`) live in `app.chat.setup`.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest
from sqlmodel import Session

from app.chat import service as service_module
from app.chat import setup as setup_module
from app.db import models
from app.pipelines.settings import IngestionPipelineSettings, RetrievalPipelineSettings
from app.schemas.models import ModelInfo
from app.schemas.openrouter import OpenRouterChatResponse
from app.schemas.retrieval import CollectionQueryResponse


@dataclass
class StubSettings:
    """Minimal settings object for driving the chat flow under test."""

    openrouter_reasoning_effort: str | None = "low"


class StubRetrievalService:
    """Retrieval service returning empty results for any query."""

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def query_collection(
        self,
        _user: models.User,
        _collection: models.Collection,
        query: str,
        top_k: int = 5,
    ) -> CollectionQueryResponse:
        return CollectionQueryResponse(query=query, top_k=top_k, chunks=[], usage={})


class StubOpenRouter:
    """OpenRouter client stub returning a fixed model + single chat response."""

    def __init__(self, model_info: ModelInfo | None, response: dict[str, Any]) -> None:
        self._model_info = model_info
        self._response = response
        self.chat_calls: list[dict[str, Any]] = []

    def get_model(self, _model_id: str) -> ModelInfo | None:
        return self._model_info

    def chat(self, **kwargs: Any) -> OpenRouterChatResponse:
        self.chat_calls.append(kwargs)
        return OpenRouterChatResponse.model_validate(self._response)


class SequencedOpenRouter:
    """OpenRouter client stub returning queued responses in order."""

    def __init__(self, model_info: ModelInfo, responses: list[dict[str, Any]]) -> None:
        self._model_info = model_info
        self._responses = list(responses)
        self.chat_calls: list[dict[str, Any]] = []

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._model_info

    def chat(self, **kwargs: Any) -> OpenRouterChatResponse:
        self.chat_calls.append(kwargs)
        return OpenRouterChatResponse.model_validate(self._responses.pop(0))


class ModelOnlyOpenRouter:
    """OpenRouter client stub used by streaming tests (no non-streaming chat)."""

    def __init__(self, model_info: ModelInfo) -> None:
        self._model_info = model_info

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._model_info


def tool_model_info(model_id: str = "tool-model", *, context_length: int = 2048) -> ModelInfo:
    """A model that advertises tool support."""
    return ModelInfo(
        id=model_id,
        name="Tool Model",
        context_length=context_length,
        supported_parameters=["tools"],
    )


@pytest.fixture(name="chat_user")
def chat_user_fixture(session: Session) -> models.User:
    """Persist and return a user with OpenRouter and Pinecone keys configured."""
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(name="make_collection")
def make_collection_fixture(session: Session):
    """Return a factory that persists a collection for a user."""

    def _make(user: models.User, name: str = "Collection") -> models.Collection:
        collection = models.Collection(
            user_id=user.id,
            name=name,
            description="",
            extra_metadata={},
        )
        session.add(collection)
        session.commit()
        session.refresh(collection)
        return collection

    return _make


@pytest.fixture(name="stub_pipeline_settings")
def stub_pipeline_settings_fixture(monkeypatch):
    """Return a factory that patches pipeline resolution in setup.

    Patches `resolve_ingestion_pipeline` / `resolve_retrieval_pipeline` (the
    consolidated resolver from `app.services.pipeline_resolution`) as imported
    by `app.chat.setup` -- chat's setup only reads `.settings` off the resolved
    result, so the stubs return a namespace carrying just that.
    """

    def _stub(*, chat_model: str | None, context_window: int = 1024) -> None:
        ingestion_settings = IngestionPipelineSettings(
            chunk_strategy=models.ChunkStrategy.TOKEN,
            chunk_size=128,
            chunk_overlap=8,
            embedding_model="embed",
            index_name="idx",
            namespace="ns",
            dimension=128,
            metric="cosine",
        )
        retrieval_settings = RetrievalPipelineSettings(
            embedding_model="embed",
            index_name="idx",
            namespace="ns",
            dimension=128,
            chat_model=chat_model,
            context_window=context_window,
        )
        monkeypatch.setattr(
            setup_module,
            "resolve_ingestion_pipeline",
            lambda *_a, **_k: SimpleNamespace(settings=ingestion_settings),
        )
        monkeypatch.setattr(
            setup_module,
            "resolve_retrieval_pipeline",
            lambda *_a, **_k: SimpleNamespace(settings=retrieval_settings),
        )

    return _stub


@pytest.fixture(name="install_chat_flow")
def install_chat_flow_fixture(monkeypatch, stub_pipeline_settings):
    """Return a factory that wires provider + pipeline collaborators for a flow."""

    def _install(
        *,
        openrouter: object,
        chat_model: str,
        retrieval_cls: type = StubRetrievalService,
        context_window: int = 1024,
    ) -> None:
        monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings())
        monkeypatch.setattr(service_module, "get_openrouter_client", lambda *_a, **_k: openrouter)
        monkeypatch.setattr(service_module, "RetrievalService", retrieval_cls)
        stub_pipeline_settings(chat_model=chat_model, context_window=context_window)

    return _install
