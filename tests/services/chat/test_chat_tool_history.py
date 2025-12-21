from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Dict, List

from app.db import models
from app.schemas.chat import ChatMessageCreate
from app.services.chat import ChatService


class _NoOpSession:
    def add(self, *args: Any, **kwargs: Any) -> None:
        return None

    def commit(self, *args: Any, **kwargs: Any) -> None:
        return None

    def flush(self, *args: Any, **kwargs: Any) -> None:
        return None


class _StubChatRepository:
    def __init__(self) -> None:
        self.sessions: Dict[str, models.ChatSession] = {}
        self.messages: List[models.ChatMessage] = []

    def add_session(self, session_model: models.ChatSession) -> models.ChatSession:
        self.sessions[str(session_model.id)] = session_model
        return session_model

    def get_session(self, session_id: Any, user_id: Any | None = None) -> models.ChatSession | None:
        return self.sessions.get(str(session_id))

    def list_messages(self, session_id: Any) -> List[models.ChatMessage]:
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


class _StubRetrieval:
    def query_collection(
        self,
        collection: Any,
        query_text: str,
        top_k: int,
        *args: Any,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        return {"chunks": [], "query": query_text, "top_k": top_k}


class _StubOpenRouter:
    def __init__(self, responses: List[Dict[str, Any]]) -> None:
        self._responses = list(responses)
        self.calls: List[Dict[str, Any]] = []

    def get_model(self, model_name: str) -> SimpleNamespace:
        return SimpleNamespace(
            supported_parameters=["tools"],
            context_length=4096,
        )

    def chat(
        self,
        *,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        model: str,
        parallel_tool_calls: bool,
        extra_body: Dict[str, Any],
        parameters: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
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
        return self._responses.pop(0)


def test_tool_call_history_replayed_for_follow_up() -> None:
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
    service.session = _NoOpSession()
    service.chat_repo = _StubChatRepository()
    service.openrouter = _StubOpenRouter([first_response, final_response])
    service.retrieval = _StubRetrieval()
    service.reasoning_effort = None
    service.settings = SimpleNamespace(openrouter_reasoning_effort=None)

    user = models.User(email="history@example.com", hashed_password="secret")
    collection = models.Collection(
        user_id=user.id,
        name="History Collection",
        description="Tracks tool calls",
        embedding_model="embed-model",
        chat_model="openrouter/test-model",
        chunk_size=256,
        chunk_overlap=64,
        pinecone_index="idx",
        pinecone_namespace="ns",
    )
    payload = ChatMessageCreate(content="Lookup docs")

    service.send_message(user=user, collection=collection, payload=payload)

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
