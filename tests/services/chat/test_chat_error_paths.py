from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.schemas.chat import ChatMessageCreate
from app.services import chat as chat_module
from app.services.chat import ChatService


class _StubRepo:
    def __init__(self, message=None, session=None, messages=None) -> None:
        self._message = message
        self._session = session
        self._messages = messages or []

    def get_message(self, *_args, **_kwargs):
        return self._message

    def get_session(self, *_args, **_kwargs):
        return self._session

    def list_messages(self, *_args, **_kwargs):
        return list(self._messages)


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

    monkeypatch.setattr(chat_module, "PipelineService", _StubPipelineService)
    monkeypatch.setattr(
        chat_module,
        "resolve_ingestion_settings",
        lambda *_args, **_kwargs: ingestion_settings,
    )
    monkeypatch.setattr(
        chat_module,
        "resolve_retrieval_settings",
        lambda *_args, **_kwargs: retrieval_settings,
    )


def test_ensure_session_rejects_collection_mismatch() -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    existing = SimpleNamespace(collection_id=uuid4())
    service.chat_repo = _StubRepo(session=existing)

    payload = ChatMessageCreate(content="hi", session_id=uuid4())
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="does not belong to this collection"):
        service._ensure_session(
            user=user,
            collection=collection,
            payload=payload,
            default_chat_model="model",
        )


def test_stream_message_raises_for_missing_edit_message(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.chat_repo = _StubRepo(message=None)
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message not found for editing"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_stream_message_raises_for_missing_edit_session(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    edit_message = SimpleNamespace(session_id=uuid4())
    service.chat_repo = _StubRepo(message=edit_message, session=None)
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Chat session not found for edit"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_stream_message_raises_for_edit_collection_mismatch(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    edit_message = SimpleNamespace(session_id=uuid4())
    session_model = SimpleNamespace(collection_id=uuid4())
    service.chat_repo = _StubRepo(message=edit_message, session=session_model)
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="different collection"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_stream_message_rejects_empty_content(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    service._ensure_session = lambda **_kwargs: session_model
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="   ")
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message content cannot be empty"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_stream_message_requires_chat_model(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model=None)
    service._ensure_session = lambda **_kwargs: session_model
    service._record_message = lambda **_kwargs: None
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch, chat_model=None)

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="chat model configured"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_stream_message_requires_available_model(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    service._ensure_session = lambda **_kwargs: session_model
    service._record_message = lambda **_kwargs: None
    service.session = SimpleNamespace()
    service.chat_repo = _StubRepo(messages=[])
    service.openrouter = SimpleNamespace(get_model=lambda _name: None)
    service.reasoning_effort = None
    service.retrieval = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    monkeypatch.setattr(chat_module, "render_system_prompt", lambda *_args, **_kwargs: "prompt")

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4(), email="user@example.com", full_name="User")
    collection = SimpleNamespace(id=uuid4(), name="Collection", description="", extra_metadata={})

    with pytest.raises(ValueError, match="Selected model is not available"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_stream_message_requires_tool_support(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    service._ensure_session = lambda **_kwargs: session_model
    service._record_message = lambda **_kwargs: None
    service.session = SimpleNamespace()
    service.chat_repo = _StubRepo(messages=[])
    service.openrouter = SimpleNamespace(
        get_model=lambda _name: SimpleNamespace(
            supported_parameters=["temperature"],
            context_length=1024,
        )
    )
    service.reasoning_effort = None
    service.retrieval = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    monkeypatch.setattr(chat_module, "render_system_prompt", lambda *_args, **_kwargs: "prompt")

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4(), email="user@example.com", full_name="User")
    collection = SimpleNamespace(id=uuid4(), name="Collection", description="", extra_metadata={})

    with pytest.raises(ValueError, match="does not support tool calls"):
        list(service.stream_message(user=user, collection=collection, payload=payload))


def test_send_message_raises_for_missing_edit_message(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.chat_repo = _StubRepo(message=None)
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="hi", edit_message_id=uuid4())
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message not found for editing"):
        service.send_message(user=user, collection=collection, payload=payload)


def test_send_message_rejects_empty_content(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model="model")
    service._ensure_session = lambda **_kwargs: session_model
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch)

    payload = ChatMessageCreate(content="   ")
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="Message content cannot be empty"):
        service.send_message(user=user, collection=collection, payload=payload)


def test_send_message_requires_chat_model(monkeypatch) -> None:
    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    session_model = SimpleNamespace(id=uuid4(), chat_model=None)
    service._ensure_session = lambda **_kwargs: session_model
    service._record_message = lambda **_kwargs: None
    service.session = SimpleNamespace()
    _stub_pipeline_helpers(monkeypatch, chat_model=None)

    payload = ChatMessageCreate(content="hi")
    user = SimpleNamespace(id=uuid4())
    collection = SimpleNamespace(id=uuid4())

    with pytest.raises(ValueError, match="chat model configured"):
        service.send_message(user=user, collection=collection, payload=payload)
