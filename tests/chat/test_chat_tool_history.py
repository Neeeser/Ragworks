"""Tool-call history must replay to the provider on follow-up iterations."""

from __future__ import annotations

from sqlmodel import Session

from app.chat.service import ChatService
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageCreate
from tests.chat.conftest import SequencedOpenRouter, tool_model_info

FIRST_RESPONSE = {
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
FINAL_RESPONSE = {
    "choices": [
        {
            "message": {"content": "Answer"},
            "finish_reason": "stop",
        }
    ],
    "usage": {"completion_tokens": 4, "total_tokens": 9},
    "model": "openrouter/test-model",
}


def test_tool_call_history_replayed_for_follow_up(
    session: Session, chat_user, make_collection, install_chat_flow
) -> None:
    openrouter = SequencedOpenRouter(
        tool_model_info("openrouter/test-model"), [FIRST_RESPONSE, FINAL_RESPONSE]
    )
    install_chat_flow(openrouter=openrouter, chat_model="openrouter/test-model")
    collection = make_collection(chat_user)
    service = ChatService(session)

    response = service.send_message(
        user=chat_user,
        payload=ChatMessageCreate(
            content="Lookup docs",
            chat_model="openrouter/test-model",
            tool_collection_ids=[collection.id],
        ),
    )

    assert len(openrouter.chat_calls) == 2
    second_messages = openrouter.chat_calls[1]["messages"]
    assert any("tool_calls" in message for message in second_messages)

    persisted = ChatRepository(session).list_messages(response.session.id)
    assistant_tool_messages = [
        message
        for message in persisted
        if message.role == models.ChatRole.ASSISTANT
        and isinstance(message.tool_payload, dict)
        and "tool_calls" in message.tool_payload
    ]
    assert assistant_tool_messages
