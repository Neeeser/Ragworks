from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any

from app.chat import setup as chat_setup_module
from app.chat.service import ChatService
from app.db import models
from app.pipelines.settings import IngestionPipelineSettings, RetrievalPipelineSettings
from app.schemas.chat import ChatMessageCreate
from app.schemas.enums import IndexBackend
from app.schemas.openrouter import OpenRouterChatResponse
from app.schemas.retrieval import CollectionQueryResponse


class _NoOpSession:
    def __init__(self, collections: list[models.Collection] | None = None) -> None:
        self._collections = list(collections or [])

    def add(self, *args: Any, **kwargs: Any) -> None:
        return None

    def commit(self, *args: Any, **kwargs: Any) -> None:
        return None

    def flush(self, *args: Any, **kwargs: Any) -> None:
        return None

    def exec(self, *_args: Any, **_kwargs: Any):
        class _Result:
            def __init__(self, collections: list[models.Collection]) -> None:
                self._collections = collections

            def all(self) -> list[models.Collection]:
                return list(self._collections)

        return _Result(self._collections)


class _StubChatRepository:
    def __init__(self) -> None:
        self.sessions: dict[str, models.ChatSession] = {}
        self.messages: list[models.ChatMessage] = []

    def add_session(self, session_model: models.ChatSession) -> models.ChatSession:
        self.sessions[str(session_model.id)] = session_model
        return session_model

    def get_session(self, session_id: Any, user_id: Any | None = None) -> models.ChatSession | None:
        return self.sessions.get(str(session_id))

    def list_messages(self, session_id: Any) -> list[models.ChatMessage]:
        return [message for message in self.messages if str(message.session_id) == str(session_id)]

    def add_message(self, message: models.ChatMessage) -> None:
        self.messages.append(message)

    def get_message(self, *args: Any, **kwargs: Any) -> None:
        return None

    def delete_messages_after(self, *args: Any, **kwargs: Any) -> None:
        return None

    def delete_tool_messages_since(self, *args: Any, **kwargs: Any) -> None:
        return None

    def delete_session(self, *args: Any, **kwargs: Any) -> None:
        return None

    def get_last_user_message_before(self, *args: Any, **kwargs: Any) -> None:
        return None

    def replace_session_collections(self, *args: Any, **kwargs: Any) -> None:
        return None


class _StubCollectionRepository:
    def __init__(self, collections: list[models.Collection] | None = None) -> None:
        self._collections = list(collections or [])

    def list_by_ids(self, _user_id: Any, _ids: Any) -> list[models.Collection]:
        return list(self._collections)


class _StubRetrieval:
    def query_collection(
        self,
        _user: Any,
        collection: Any,
        query_text: str,
        top_k: int,
        *args: Any,
        **kwargs: Any,
    ) -> CollectionQueryResponse:
        return CollectionQueryResponse(query=query_text, top_k=top_k, chunks=[], usage={})


class _StubOpenRouter:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def get_model(self, model_name: str) -> SimpleNamespace:
        return SimpleNamespace(
            supported_parameters=["tools"],
            context_length=4096,
        )

    def chat(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str,
        parallel_tool_calls: bool,
        extra_body: dict[str, Any],
        parameters: dict[str, Any] | None,
    ) -> OpenRouterChatResponse:
        self.calls.append(
            {
                "messages": deepcopy(messages),
                "tools": deepcopy(tools),
                "model": model,
                "parallel_tool_calls": parallel_tool_calls,
                "extra_body": deepcopy(extra_body),
                "parameters": deepcopy(parameters),
            }
        )
        return OpenRouterChatResponse.model_validate(self._responses.pop(0))


def _stub_pipeline_helpers(monkeypatch) -> None:
    """Patch the consolidated pipeline resolver at chat setup's boundary.

    `_resolve_pipeline_context` now calls `resolve_ingestion_pipeline` /
    `resolve_retrieval_pipeline` (app/services/pipeline_resolution.py) and
    reads only `.settings` off each result, so that's the whole surface the
    stubs need to provide.
    """
    ingestion_settings = IngestionPipelineSettings(
        chunk_strategy=models.ChunkStrategy.TOKEN,
        chunk_size=256,
        chunk_overlap=64,
        embedding_model="embed-model",
        backend=IndexBackend.PINECONE,
        index_name="idx",
        namespace="ns",
        dimension=128,
        metric="cosine",
    )
    retrieval_settings = RetrievalPipelineSettings(
        embedding_model="embed-model",
        backend=IndexBackend.PINECONE,
        index_name="idx",
        namespace="ns",
        dimension=128,
        chat_model="openrouter/test-model",
        context_window=8192,
    )

    monkeypatch.setattr(
        chat_setup_module,
        "resolve_ingestion_pipeline",
        lambda *_args, **_kwargs: SimpleNamespace(settings=ingestion_settings),
    )
    monkeypatch.setattr(
        chat_setup_module,
        "resolve_retrieval_pipeline",
        lambda *_args, **_kwargs: SimpleNamespace(settings=retrieval_settings),
    )


def test_tool_call_history_replayed_for_follow_up(monkeypatch) -> None:
    first_response = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call-1",
                            "type": "function",
                            "function": {
                                "name": "pinecone_query",
                                "arguments": '{"query":"docs"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 5},
        "model": "openrouter/test-model",
    }
    final_response = {
        "choices": [
            {
                "message": {"content": "Answer"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"completion_tokens": 4, "total_tokens": 9},
        "model": "openrouter/test-model",
    }

    service = ChatService.__new__(ChatService)  # type: ignore[call-arg]
    service.chat_repo = _StubChatRepository()
    service.provider = None
    service.openrouter = _StubOpenRouter([first_response, final_response])
    service.retrieval = _StubRetrieval()
    service.reasoning_effort = None
    service.settings = SimpleNamespace(
        openrouter_reasoning_effort=None,
        default_chat_model="openrouter/test-model",
    )
    _stub_pipeline_helpers(monkeypatch)

    user = models.User(
        email="history@example.com",
        hashed_password="secret",
        pinecone_api_key="pinecone-key",
    )
    collection = models.Collection(
        user_id=user.id,
        name="History Collection",
        description="Tracks tool calls",
        extra_metadata={},
    )
    service.session = _NoOpSession([collection])
    service.collection_repo = _StubCollectionRepository([collection])
    payload = ChatMessageCreate(content="Lookup docs", tool_collection_ids=[collection.id])

    service.send_message(user=user, payload=payload)

    assert len(service.openrouter.calls) == 2
    second_messages = service.openrouter.calls[1]["messages"]
    assert any("tool_calls" in message for message in second_messages)

    assistant_tool_messages = [
        message
        for message in service.chat_repo.messages
        if message.role == models.ChatRole.ASSISTANT
        and isinstance(message.tool_payload, dict)
        and "tool_calls" in message.tool_payload
    ]
    assert assistant_tool_messages
