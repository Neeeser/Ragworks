"""Shared fixtures and provider/pipeline stubs for the chat test suite.

These consolidate the per-file `_create_user` / `_create_collection` /
`_stub_pipeline_helpers` builders that used to be copy-pasted across the chat
service tests. Provider and pipeline collaborators are patched at their real
boundaries: `get_settings` / `ToolInvocationService` live in
`app.chat.service`, `ProviderResolver` in `app.chat.setup`, while
`resolve_ingest_binding` / `resolve_tool_bindings` (the consolidated resolver
in `app.services.pipeline_resolution`) live in `app.chat.setup`.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session

from app.chat import model_settings as model_settings_module
from app.chat import service as service_module
from app.chat import setup as setup_module
from app.chat import tool_contexts as tool_contexts_module
from app.db import models
from app.pipelines.interface import PipelineInterface, ToolOutputKind
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.settings import PipelineSettings
from app.schemas.enums import IndexBackend
from app.schemas.models import ModelInfo
from app.schemas.openrouter import OpenRouterChatResponse
from app.schemas.tools import ToolInvocationResponse
from app.services.tool_projection import build_parameter_schema, tool_description


@dataclass
class StubSettings:
    """Minimal settings object for driving the chat flow under test."""

    openrouter_reasoning_effort: str | None = "low"


class StubInvocationService:
    """Tool invocation service returning empty results for any call.

    Records every call's kwargs so tests can assert whether the executor took
    the legacy `top_k` path or the declared-`arguments` path.
    """

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self.calls: list[dict[str, object]] = []

    def invoke_binding(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        _user: models.User,
        _collection: models.Collection,
        binding_id: UUID,
        query: str,
        top_k: int | None = None,
        arguments: dict[str, object] | None = None,
    ) -> ToolInvocationResponse:
        self.calls.append({"query": query, "top_k": top_k, "arguments": arguments})
        return ToolInvocationResponse(
            kind="chunks",
            tool_binding_id=binding_id,
            query=query,
            top_k=top_k if top_k is not None else 5,
            chunks=[],
            usage={},
        )


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


def _stub_settings(backend: IndexBackend = IndexBackend.PINECONE) -> PipelineSettings:
    """Minimal resolved settings for stubbed pipeline contexts."""
    return PipelineSettings(
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


def make_tool_context(
    collection: models.Collection,
    *,
    tool_name: str = "pinecone_query",
    query_arguments: tuple = (),
) -> setup_module.ToolContext:
    """Build a minimal ToolContext for direct ToolExecutor tests."""
    from app.chat.state import ToolContext

    return ToolContext(
        collection=collection,
        binding_id=uuid4(),
        tool_name=tool_name,
        description=tool_description(
            PipelineInterface(callable=True, output_kind=ToolOutputKind.CHUNKS),
            collection,
        ),
        parameters=build_parameter_schema(query_arguments),
        settings=_stub_settings(),
        query_arguments=query_arguments,
    )


def wrap_tool_contexts(
    collection: models.Collection,
    *tools: setup_module.ToolContext,
) -> setup_module.ToolCollectionContext:
    """Wrap ToolContexts in the per-collection shape `ToolExecutor.specs` reads."""
    from app.chat.state import ToolCollectionContext

    return ToolCollectionContext(
        collection=collection,
        tool_name=tools[0].tool_name if tools else "search",
        ingestion_settings=_stub_settings(),
        retrieval_settings=_stub_settings(),
        tools=tuple(tools),
    )


@pytest.fixture(name="stub_pipeline_settings")
def stub_pipeline_settings_fixture(monkeypatch, session: Session, chat_user: models.User):
    """Return a factory that patches pipeline resolution in setup.

    Patches `resolve_ingest_binding` / `resolve_primary_tool` (the
    consolidated resolver from `app.services.pipeline_resolution`) as imported
    by `app.chat.setup` -- chat's setup reads `.settings` off both results and
    `.definition` off the retrieval one (for declared query arguments), so the
    stubs return namespaces carrying exactly those.

    `chat_model` stamps the user's sticky last-used model (there are no
    global default models) so a new session seeds it exactly the way a
    returning user's would. `query_arguments` declares input arguments on the
    stubbed retrieval definition (the pipeline-driven tool schema path).
    """

    def _stub(
        *,
        chat_model: str | None,
        backend: IndexBackend = IndexBackend.PINECONE,
        query_arguments: tuple = (),
    ) -> None:
        chat_user.last_used_chat_model = chat_model
        session.add(chat_user)
        session.commit()
        settings = _stub_settings(backend)
        interface = PipelineInterface(
            callable=True,
            arguments=list(query_arguments),
            output_kind=ToolOutputKind.CHUNKS,
        )
        monkeypatch.setattr(
            tool_contexts_module,
            "resolve_ingest_binding",
            lambda *_a, **_k: SimpleNamespace(settings=settings),
        )
        monkeypatch.setattr(
            tool_contexts_module,
            "resolve_tool_bindings",
            lambda *_a, **_k: [
                SimpleNamespace(
                    binding=SimpleNamespace(id=uuid4(), is_primary=True),
                    interface=interface,
                    settings=settings,
                )
            ],
        )

    return _stub


@pytest.fixture(name="install_chat_flow")
def install_chat_flow_fixture(monkeypatch, stub_pipeline_settings):
    """Return a factory that wires provider + pipeline collaborators for a flow."""

    def _install(
        *,
        openrouter: object,
        chat_model: str,
        invocation_cls: type = StubInvocationService,
        backend: IndexBackend = IndexBackend.PINECONE,
    ) -> None:
        monkeypatch.setattr(service_module, "get_settings", lambda: StubSettings())
        monkeypatch.setattr(
            model_settings_module, "ProviderResolver", stub_resolver_class(openrouter)
        )
        monkeypatch.setattr(service_module, "ToolInvocationService", invocation_cls)
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
