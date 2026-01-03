from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.schemas.models import ModelInfo
from app.chat import service as chat_service_module
from app.chat.service import ChatService


@dataclass
class _StubSettings:
    openrouter_reasoning_effort: str | None = "low"


class _StubRetrievalService:
    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def query_collection(
        self,
        _user: models.User,
        _collection: models.Collection,
        _query: str,
        top_k: int = 5,
    ):
        return {"chunks": [], "top_k": top_k}


class _StubOpenRouter:
    def __init__(self, model_info: ModelInfo | None, response: dict[str, Any]) -> None:
        self._model_info = model_info
        self._response = response
        self.chat_calls: list[dict[str, Any]] = []

    def get_model(self, _model_id: str) -> ModelInfo | None:
        return self._model_info

    def chat(self, **kwargs: Any) -> dict[str, Any]:
        self.chat_calls.append(kwargs)
        return dict(self._response)


class _SequencedOpenRouter:
    def __init__(self, model_info: ModelInfo, responses: list[dict[str, Any]]) -> None:
        self._model_info = model_info
        self._responses = list(responses)
        self.chat_calls: list[dict[str, Any]] = []

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._model_info

    def chat(self, **kwargs: Any) -> dict[str, Any]:
        self.chat_calls.append(kwargs)
        return dict(self._responses.pop(0))


class _ModelOnlyOpenRouter:
    def __init__(self, model_info: ModelInfo) -> None:
        self._model_info = model_info

    def get_model(self, _model_id: str) -> ModelInfo:
        return self._model_info


def _stub_pipeline_settings(monkeypatch, *, chat_model: str, context_window: int = 1024) -> None:
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


def _create_user(session: Session) -> models.User:
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


def _create_collection(session: Session, user: models.User, chat_model: str) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_send_message_records_response(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, chat_model="test-model")

    model_info = ModelInfo(
        id="test-model",
        name="Test Model",
        context_length=2048,
        supported_parameters=["tools", "reasoning"],
    )
    response = {
        "id": "resp-1",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": "Answer",
                    "reasoning": [{"type": "text", "content": "thinking"}],
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 3,
            "completion_tokens": 5,
            "total_tokens": 8,
            "reasoning_tokens": 2,
            "cost": "0.01",
        },
    }
    openrouter = _StubOpenRouter(model_info=model_info, response=response)

    monkeypatch.setattr(chat_service_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(
        chat_service_module, "get_openrouter_client", lambda *_args, **_kwargs: openrouter
    )
    monkeypatch.setattr(chat_service_module, "RetrievalService", _StubRetrievalService)
    _stub_pipeline_settings(monkeypatch, chat_model="test-model")

    service = ChatService(session)
    payload = ChatMessageCreate(content="hello")

    result = service.send_message(user=user, collection=collection, payload=payload)

    assert result.provider == "openrouter"
    assert result.messages[-1].content == "Answer"
    assert result.usage["total_tokens"] == 8
    assert openrouter.chat_calls


def test_send_message_raises_for_missing_model(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, chat_model="missing-model")

    openrouter = _StubOpenRouter(model_info=None, response={})

    monkeypatch.setattr(chat_service_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(
        chat_service_module, "get_openrouter_client", lambda *_args, **_kwargs: openrouter
    )
    monkeypatch.setattr(chat_service_module, "RetrievalService", _StubRetrievalService)
    _stub_pipeline_settings(monkeypatch, chat_model="missing-model")

    service = ChatService(session)

    with pytest.raises(ValueError, match="Selected model is not available"):
        service.send_message(user=user, collection=collection, payload=ChatMessageCreate(content="hi"))


def test_send_message_requires_tool_support(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, chat_model="model-without-tools")

    model_info = ModelInfo(
        id="model-without-tools",
        name="Test Model",
        context_length=1024,
        supported_parameters=["temperature"],
    )
    openrouter = _StubOpenRouter(model_info=model_info, response={})

    monkeypatch.setattr(chat_service_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(
        chat_service_module, "get_openrouter_client", lambda *_args, **_kwargs: openrouter
    )
    monkeypatch.setattr(chat_service_module, "RetrievalService", _StubRetrievalService)
    _stub_pipeline_settings(monkeypatch, chat_model="model-without-tools")

    service = ChatService(session)

    with pytest.raises(ValueError, match="does not support tool calls"):
        service.send_message(user=user, collection=collection, payload=ChatMessageCreate(content="hi"))


def test_send_message_handles_tool_calls(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, chat_model="tool-model")

    model_info = ModelInfo(
        id="tool-model",
        name="Tool Model",
        context_length=2048,
        supported_parameters=["tools"],
    )
    responses = [
        {
            "id": "resp-1",
            "provider": "openrouter",
            "model": "tool-model",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "content": "Calling tool",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "pinecone_query",
                                    "arguments": "{\"query\": \"docs\", \"top_k\": 2}",
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        },
        {
            "id": "resp-2",
            "provider": "openrouter",
            "model": "tool-model",
            "choices": [
                {
                    "index": 0,
                    "message": {"content": "Final answer"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
        },
    ]
    openrouter = _SequencedOpenRouter(model_info=model_info, responses=responses)

    class _TrackingRetrievalService(_StubRetrievalService):
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def query_collection(
            self,
            _user: models.User,
            collection: models.Collection,
            query: str,
            top_k: int = 5,
        ):
            self.calls.append({"collection": collection, "query": query, "top_k": top_k})
            return {"chunks": [], "top_k": top_k}

    retrieval = _TrackingRetrievalService()

    monkeypatch.setattr(chat_service_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(
        chat_service_module, "get_openrouter_client", lambda *_args, **_kwargs: openrouter
    )
    monkeypatch.setattr(chat_service_module, "RetrievalService", lambda *_args, **_kwargs: retrieval)
    _stub_pipeline_settings(monkeypatch, chat_model="tool-model")

    service = ChatService(session)

    result = service.send_message(user=user, collection=collection, payload=ChatMessageCreate(content="hi"))

    assert result.messages[-1].content == "Final answer"
    assert result.tool_traces[0].name == "pinecone_query"
    assert retrieval.calls[0]["top_k"] == 2


def test_stream_message_handles_tool_calls_and_final(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, chat_model="tool-model")

    model_info = ModelInfo(
        id="tool-model",
        name="Tool Model",
        context_length=2048,
        supported_parameters=["tools"],
    )

    retrieval_calls: list[dict[str, Any]] = []

    class _TrackingRetrievalService(_StubRetrievalService):
        def query_collection(
            self,
            _user: models.User,
            collection: models.Collection,
            query: str,
            top_k: int = 5,
        ):
            retrieval_calls.append({"collection": collection, "query": query, "top_k": top_k})
            return {"chunks": [], "top_k": top_k}

    def _make_stream(events, result):
        def _gen():
            for event in events:
                yield event
            return result

        return _gen()

    tool_message = {
        "content": "Calling tool",
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "pinecone_query", "arguments": "{\"query\": \"docs\", \"top_k\": 2}"},
            }
        ],
    }
    final_message = {"content": "Final answer"}

    stream_results = [
        {
            "events": [
                {"type": "token", "content": "Calling"},
                {"type": "reasoning", "segments": [{"type": "text", "content": "thinking"}]},
            ],
            "result": (
                tool_message,
                {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                "openrouter",
                "tool_calls",
                "tool-model",
            ),
        },
        {
            "events": [{"type": "token", "content": "Final"}],
            "result": (
                final_message,
                {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
                "openrouter",
                "stop",
                "tool-model",
            ),
        },
    ]

    def _stream_model_completion(**_kwargs):
        entry = stream_results.pop(0)
        return _make_stream(entry["events"], entry["result"])

    monkeypatch.setattr(chat_service_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(
        chat_service_module,
        "get_openrouter_client",
        lambda *_args, **_kwargs: _ModelOnlyOpenRouter(model_info),
    )
    monkeypatch.setattr(chat_service_module, "RetrievalService", _TrackingRetrievalService)
    monkeypatch.setattr(chat_service_module, "stream_model_completion", _stream_model_completion)
    _stub_pipeline_settings(monkeypatch, chat_model="tool-model")

    service = ChatService(session)

    payload = ChatMessageCreate(content="hi")
    events = list(service.stream_message(user=user, collection=collection, payload=payload))

    assert any(event.get("type") == "tool_call" for event in events if isinstance(event, dict))
    assert any(event.get("type") == "tool_result" for event in events if isinstance(event, dict))
    assert events[-1]["type"] == "final"
    assert retrieval_calls[0]["top_k"] == 2


def test_send_message_uses_reasoning_content_fallback_and_list_content(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user, chat_model="test-model")

    model_info = ModelInfo(
        id="test-model",
        name="Test Model",
        context_length=1024,
        supported_parameters=["tools"],
    )
    response = {
        "id": "resp-1",
        "provider": "openrouter",
        "model": "test-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": [{"text": "Hello"}],
                    "reasoning_content": "because",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"total_tokens": 2},
    }
    openrouter = _StubOpenRouter(model_info=model_info, response=response)

    monkeypatch.setattr(chat_service_module, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(
        chat_service_module, "get_openrouter_client", lambda *_args, **_kwargs: openrouter
    )
    monkeypatch.setattr(chat_service_module, "RetrievalService", _StubRetrievalService)
    _stub_pipeline_settings(monkeypatch, chat_model="test-model")

    service = ChatService(session)
    payload = ChatMessageCreate(content="hello")

    result = service.send_message(user=user, collection=collection, payload=payload)

    assert result.messages[-1].content == '[{"text": "Hello"}]'
    assert result.usage["total_tokens"] == 2
