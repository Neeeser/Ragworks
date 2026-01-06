from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.schemas.chat import ChatMessageCreate
from app.chat import service as chat_service_module
from app.chat.service import ChatService
from app.chat.state import ToolCollectionContext


class _StubRepo:
    def __init__(self, message=None, session=None, messages=None) -> None:
        self._message = message
        self._session = session
        self._messages = list(messages or [])

    def get_message(self, *_args, **_kwargs):
        return self._message

    def get_session(self, *_args, **_kwargs):
        return self._session

    def list_messages(self, *_args, **_kwargs):
        return list(self._messages)

    def add_message(self, message):
        self._messages.append(message)

    def replace_session_collections(self, *args, **kwargs):
        return None

    def list_session_collection_ids(self, *args, **kwargs):
        return []


class _StubSession:
    def add(self, *args, **kwargs):
        return None

    def flush(self, *args, **kwargs):
        return None

    def commit(self, *args, **kwargs):
        return None


def _stub_pipeline_helpers(monkeypatch, *, chat_model: str | None = "model", context_window: int = 1024):
    class _StubPipelineService:
        def __init__(self, _session) -> None:
            pass

        def ensure_default_pipelines(self, _user):
            return SimpleNamespace(
                ingestion=SimpleNamespace(id=uuid4()),
                retrieval=SimpleNamespace(id=uuid4()),
            )

        def ensure_collection_pipelines(self, collection, defaults):
            collection.ingestion_pipeline_id = (
                getattr(collection, "ingestion_pipeline_id", None) or defaults.ingestion.id
            )
            collection.retrieval_pipeline_id = (
                getattr(collection, "retrieval_pipeline_id", None) or defaults.retrieval.id
            )
            return collection

        def get_pipeline(self, pipeline_id, _user_id):
            return SimpleNamespace(id=pipeline_id)

        def get_definition(self, _pipeline):
            return SimpleNamespace(nodes=[])

    ingestion_settings = SimpleNamespace(
        chunk_strategy="token",
        chunk_size=128,
        chunk_overlap=8,
        embedding_model="embed",
        index_name="idx",
        namespace="ns",
        dimension=128,
        metric="cosine",
    )
    retrieval_settings = SimpleNamespace(
        embedding_model="embed",
        index_name="idx",
        namespace="ns",
        dimension=128,
        metric="cosine",
        chat_model=chat_model,
        context_window=context_window,
    )

    monkeypatch.setattr(chat_service_module, "PipelineService", _StubPipelineService)
    monkeypatch.setattr(
        chat_service_module,
        "resolve_ingestion_settings",
        lambda *_args, **_kwargs: ingestion_settings,
    )
    monkeypatch.setattr(
        chat_service_module,
        "resolve_retrieval_settings",
        lambda *_args, **_kwargs: retrieval_settings,
    )


def test_stream_message_raises_for_missing_edit_message(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.chat_repo = _StubRepo(message=None)
    service.session = _StubSession()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message not found for editing"):
        list(service.stream_message(user=user, payload=payload))


def test_stream_message_raises_for_missing_edit_session(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    edit_message = SimpleNamespace(session_id=uuid4())
    service.chat_repo = _StubRepo(message=edit_message, session=None)
    service.session = _StubSession()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Chat session not found for edit"):
        list(service.stream_message(user=user, payload=payload))


def test_stream_message_rejects_empty_content(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    service.session = _StubSession()
    service.chat_repo = _StubRepo()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="   ")
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message content cannot be empty"):
        list(service.stream_message(user=user, payload=payload))


def test_stream_message_requires_chat_model(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model=None)
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    monkeypatch.setattr(chat_service_module, "record_message", lambda *_args, **_kwargs: None)
    service.session = _StubSession()
    service.chat_repo = _StubRepo()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model=None, openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch, chat_model=None)
    monkeypatch.setattr(chat_service_module, "render_system_prompt", lambda *_args, **_kwargs: "prompt")

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="No chat model is configured"):
        list(service.stream_message(user=user, payload=payload))


def test_stream_message_requires_available_model(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    monkeypatch.setattr(chat_service_module, "record_message", lambda *_args, **_kwargs: None)
    service.session = _StubSession()
    service.chat_repo = _StubRepo(messages=[])
    service.openrouter = SimpleNamespace(get_model=lambda _name: None)
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    service.reasoning_effort = None
    service.retrieval = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    monkeypatch.setattr(chat_service_module, "render_system_prompt", lambda *_args, **_kwargs: "prompt")

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4(), email="user@example.com", full_name="User")

    with pytest.raises(ValueError, match="Selected model is not available"):
        list(service.stream_message(user=user, payload=payload))


def test_stream_message_requires_tool_support(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    monkeypatch.setattr(chat_service_module, "record_message", lambda *_args, **_kwargs: None)
    service.session = _StubSession()
    service.chat_repo = _StubRepo(messages=[])
    service.openrouter = SimpleNamespace(
        get_model=lambda _name: SimpleNamespace(
            supported_parameters=["temperature"],
            context_length=1024,
        )
    )
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    service.reasoning_effort = None
    service.retrieval = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    monkeypatch.setattr(chat_service_module, "render_system_prompt", lambda *_args, **_kwargs: "prompt")
    tool_collection_id = uuid4()
    tool_context = ToolCollectionContext(
        collection=SimpleNamespace(id=tool_collection_id, name="Collection", description="", extra_metadata={}),
        tool_name="tool",
        ingestion_settings=SimpleNamespace(
            chunk_strategy="token",
            chunk_size=128,
            chunk_overlap=8,
            embedding_model="embed",
            index_name="idx",
            namespace="ns",
            dimension=128,
            metric="cosine",
        ),
        retrieval_settings=SimpleNamespace(
            embedding_model="embed",
            index_name="idx",
            namespace="ns",
            dimension=128,
            metric="cosine",
            chat_model="model",
            context_window=1024,
        ),
    )
    service._resolve_tool_collections = lambda **_kwargs: ([tool_context], [tool_collection_id])

    payload = ChatMessageCreate(content="hi", tool_collection_ids=[tool_collection_id])
    user = SimpleNamespace(id=uuid4(), email="user@example.com", full_name="User", pinecone_api_key="key")

    with pytest.raises(ValueError, match="does not support tool calls"):
        list(service.stream_message(user=user, payload=payload))


def test_send_message_raises_for_missing_edit_message(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.chat_repo = _StubRepo(message=None)
    service.session = _StubSession()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message not found for editing"):
        service.send_message(user=user, payload=payload)


def test_send_message_rejects_empty_content(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    service.session = _StubSession()
    service.chat_repo = _StubRepo()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model="model", openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="   ")
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message content cannot be empty"):
        service.send_message(user=user, payload=payload)


def test_send_message_requires_chat_model(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model=None)
    monkeypatch.setattr(chat_service_module, "ensure_session", lambda *_args, **_kwargs: session_model)
    monkeypatch.setattr(chat_service_module, "record_message", lambda *_args, **_kwargs: None)
    service.session = _StubSession()
    service.chat_repo = _StubRepo()
    service.openrouter = SimpleNamespace()
    service.settings = SimpleNamespace(default_chat_model=None, openrouter_reasoning_effort=None)
    _stub_pipeline_helpers(monkeypatch, chat_model=None)
    monkeypatch.setattr(chat_service_module, "render_system_prompt", lambda *_args, **_kwargs: "prompt")

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="No chat model is configured"):
        service.send_message(user=user, payload=payload)
