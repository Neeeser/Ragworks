"""Shared fixtures and provider/pipeline stubs for the chat test suite.

These consolidate the per-file `_create_user` / `_create_collection` /
`_stub_pipeline_helpers` builders that used to be copy-pasted across the chat
service tests. Provider and pipeline collaborators are patched at their real
boundaries: `get_settings` / `RetrievalService` live in `app.chat.service`,
`ProviderResolver` in `app.chat.setup`, while `resolve_ingestion_pipeline` /
`resolve_retrieval_pipeline` (the consolidated resolver in
`app.services.pipeline_resolution`) live in `app.chat.setup`.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest
from sqlmodel import Session

from app.chat import model_settings as model_settings_module
from app.chat import service as service_module
from app.chat import setup as setup_module
from app.db import models
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.settings import IngestionPipelineSettings, RetrievalPipelineSettings
from app.schemas.enums import IndexBackend
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
    """Persist a user with OpenRouter + Pinecone connections configured.

    The OpenRouter connection is also stamped as the user's last-used chat
    connection so new sessions resolve a provider without every test passing
    `provider_connection_id` explicitly (mirroring a real returning user).
    """
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    openrouter_connection = models.ProviderConnection(
        user_id=user.id,
        provider_type="openrouter",
        label="OpenRouter",
        config={"api_key": "openrouter-key"},
    )
    pinecone_connection = models.ProviderConnection(
        user_id=user.id,
        provider_type="pinecone",
        label="Pinecone",
        config={"api_key": "pinecone-key"},
    )
    session.add(openrouter_connection)
    session.add(pinecone_connection)
    session.commit()
    user.last_used_chat_connection_id = openrouter_connection.id
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
def stub_pipeline_settings_fixture(monkeypatch, session: Session, chat_user: models.User):
    """Return a factory that patches pipeline resolution in setup.

    Patches `resolve_ingestion_pipeline` / `resolve_retrieval_pipeline` (the
    consolidated resolver from `app.services.pipeline_resolution`) as imported
    by `app.chat.setup` -- chat's setup only reads `.settings` off the resolved
    result, so the stubs return a namespace carrying just that.

    `chat_model` stamps the user's sticky last-used model (there are no
    global default models) so a new session seeds it exactly the way a
    returning user's would.
    """

    def _stub(
        *,
        chat_model: str | None,
        backend: IndexBackend = IndexBackend.PINECONE,
    ) -> None:
        chat_user.last_used_chat_model = chat_model
        session.add(chat_user)
        session.commit()
        ingestion_settings = IngestionPipelineSettings(
            chunk_strategy=models.ChunkStrategy.TOKEN,
            chunk_size=128,
            chunk_overlap=8,
            tokenizer=TokenizerSpec(kind="wordpiece"),
            embedding_model="embed",
            backend=backend,
            index_name="idx",
            namespace="ns",
            dimension=128,
            metric="cosine",
        )
        retrieval_settings = RetrievalPipelineSettings(
            embedding_model="embed",
            backend=backend,
            index_name="idx",
            namespace="ns",
            dimension=128,
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
        backend: IndexBackend = IndexBackend.PINECONE,
    ) -> None:
        monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings())
        monkeypatch.setattr(
            model_settings_module, "ProviderResolver", stub_resolver_class(openrouter)
        )
        monkeypatch.setattr(service_module, "RetrievalService", retrieval_cls)
        stub_pipeline_settings(chat_model=chat_model, backend=backend)

    return _install


def stub_resolver_class(openrouter: object) -> type:
    """Build a `ProviderResolver` stand-in that wraps the given client stub.

    The stub client is wrapped in the real `OpenRouterProvider`, so the tests
    exercise the genuine provider translation layer with only the HTTP client
    faked -- the same boundary the old `get_openrouter_client` patch faked.
    """
    from app.providers.chat.openrouter import OpenRouterProvider

    class _StubResolver:
        def __init__(self, _user: models.User, _session: Session) -> None:
            pass

        def adapter(self, _connection_id, _kind) -> SimpleNamespace:
            return SimpleNamespace(
                chat_provider=lambda: OpenRouterProvider(openrouter),
                connection=SimpleNamespace(label="OpenRouter"),
            )

    return _StubResolver
