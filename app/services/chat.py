from __future__ import annotations

import json
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from sqlmodel import Session

from app.api.config import get_settings
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import (
    ChatCompletionResponse,
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionRead,
    ToolCallTrace,
)
from app.services.openrouter import get_openrouter_client
from app.services.retrieval import RetrievalService


class ChatService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()
        self.chat_repo = ChatRepository(session)
        self.openrouter = get_openrouter_client()
        self.retrieval = RetrievalService()

    @staticmethod
    def _coerce_usage_value(value: object) -> Optional[int]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            try:
                return int(float(value))
            except ValueError:
                return None
        if isinstance(value, dict):
            total = 0
            has_component = False
            for nested in value.values():
                coerced = ChatService._coerce_usage_value(nested)
                if coerced is not None:
                    total += coerced
                    has_component = True
            return total if has_component else None
        return None

    def _system_prompt(self, collection: models.Collection) -> str:
        metadata_lines = [f"- Collection: {collection.name}", f"- Description: {collection.description or 'N/A'}"]
        strategy = (
            collection.chunk_strategy.value
            if isinstance(collection.chunk_strategy, models.ChunkStrategy)
            else str(collection.chunk_strategy)
        )
        metadata_lines.append(f"- Chunking: {strategy} ({collection.chunk_size}/{collection.chunk_overlap})")
        metadata_lines.append(f"- Context window: {collection.context_window} tokens")
        metadata_lines.append(
            "- Always transparently describe the context you used, "
            "the provider/model, and any tool calls you triggered."
        )
        metadata_lines.append("- Only use the pinecone_query tool for grounded responses.")
        return (
            "You are TransparentRAG, a Retrieval-Augmented assistant. "
            "Prioritize transparency and cite the retrieved chunks you rely on. "
            "Dataset metadata:\n"
            + "\n".join(metadata_lines)
        )

    def _tool_spec(self, collection: models.Collection) -> List[Dict[str, object]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "pinecone_query",
                    "description": (
                        "Search the Pinecone namespace for this collection to gather grounded context. "
                        "Always call this tool before answering user questions about the documents."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Natural language search query."},
                            "top_k": {
                                "type": "integer",
                                "description": "How many chunks to retrieve (max 10).",
                                "default": 5,
                                "minimum": 1,
                                "maximum": 10,
                            },
                        },
                        "required": ["query"],
                    },
                },
            }
        ]

    def _ensure_session(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        payload: ChatMessageCreate,
    ) -> models.ChatSession:
        if payload.session_id:
            existing = self.chat_repo.get_session(payload.session_id, user_id=user.id)
            if existing:
                return existing
        title = payload.title or payload.content[:60]
        session_model = models.ChatSession(
            user_id=user.id,
            collection_id=collection.id,
            title=title,
            mode=payload.mode,
            chat_model=collection.chat_model,
        )
        self.chat_repo.add_session(session_model)
        self.session.commit()
        return session_model

    def _serialize_message(self, message: models.ChatMessage) -> Dict[str, object]:
        if message.role == models.ChatRole.TOOL:
            return {
                "role": "tool",
                "tool_call_id": message.tool_call_id,
                "content": message.content,
            }
        role_value = message.role.value if isinstance(message.role, models.ChatRole) else str(message.role)
        return {"role": role_value, "content": message.content}

    def _record_message(
        self,
        *,
        session_id: UUID,
        role: models.ChatRole,
        content: str,
        model: Optional[str] = None,
        tool_name: Optional[str] = None,
        tool_call_id: Optional[str] = None,
        tool_payload: Optional[Dict[str, object]] = None,
        reasoning: Optional[Dict[str, object]] = None,
        usage: Optional[Dict[str, int]] = None,
    ) -> models.ChatMessage:
        usage_payload = usage or {}
        message = models.ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            model=model,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            tool_payload=tool_payload,
            reasoning_trace=reasoning,
            prompt_tokens=usage_payload.get("prompt_tokens"),
            completion_tokens=usage_payload.get("completion_tokens"),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.chat_repo.add_message(message)
        self.session.commit()
        return message

    def _convert_session(self, session_model: models.ChatSession) -> ChatSessionRead:
        return ChatSessionRead(
            id=session_model.id,
            collection_id=session_model.collection_id,
            user_id=session_model.user_id,
            title=session_model.title,
            mode=session_model.mode,
            chat_model=session_model.chat_model,
            context_tokens=session_model.context_tokens,
            created_at=session_model.created_at,
            updated_at=session_model.updated_at,
        )

    def _convert_messages(self, session_id: UUID) -> List[ChatMessageRead]:
        messages = self.chat_repo.list_messages(session_id)
        return [
            ChatMessageRead(
                id=msg.id,
                session_id=msg.session_id,
                role=msg.role,
                content=msg.content,
                model=msg.model,
                tool_name=msg.tool_name,
                tool_payload=msg.tool_payload,
                tool_call_id=msg.tool_call_id,
                reasoning_trace=msg.reasoning_trace,
                prompt_tokens=msg.prompt_tokens,
                completion_tokens=msg.completion_tokens,
                created_at=msg.created_at,
            )
            for msg in messages
        ]

    def send_message(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        payload: ChatMessageCreate,
    ) -> ChatCompletionResponse:
        session_model = self._ensure_session(user=user, collection=collection, payload=payload)
        self._record_message(
            session_id=session_model.id,
            role=models.ChatRole.USER,
            content=payload.content,
        )

        history = self.chat_repo.list_messages(session_model.id)
        messages = [{"role": "system", "content": self._system_prompt(collection)}]
        for msg in history:
            messages.append(self._serialize_message(msg))

        tools = self._tool_spec(collection)
        tool_traces: List[ToolCallTrace] = []
        usage_aggregate: Dict[str, int] = {}
        provider = "openrouter"

        max_iterations = 4
        iteration = 0
        final_response: Optional[Dict[str, object]] = None

        while iteration < max_iterations:
            iteration += 1
            response = self.openrouter.chat(
                messages=messages,
                tools=tools,
                model=collection.chat_model,
                parallel_tool_calls=True,
            )
            final_response = response
            choice = response["choices"][0]
            message = choice.get("message", {})
            finish_reason = choice.get("finish_reason")
            usage = response.get("usage") or {}
            provider = response.get("provider", provider)

            if usage:
                for key, value in usage.items():
                    coerced = self._coerce_usage_value(value)
                    if coerced is None:
                        continue
                    usage_aggregate[key] = usage_aggregate.get(key, 0) + coerced

            tool_calls = message.get("tool_calls")
            if tool_calls:
                messages.append({"role": "assistant", "content": message.get("content"), "tool_calls": tool_calls})
                for tool_call in tool_calls:
                    name = tool_call["function"]["name"]
                    try:
                        arguments = json.loads(tool_call["function"]["arguments"] or "{}")
                    except json.JSONDecodeError:
                        arguments = {"query": tool_call["function"]["arguments"]}
                    query_text = arguments.get("query") or arguments.get("text") or payload.content
                    top_k = int(arguments.get("top_k", 5))
                    retrieval_response = self.retrieval.query_collection(collection, query_text, top_k=top_k)
                    tool_content = json.dumps(retrieval_response)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call["id"],
                            "content": tool_content,
                        }
                    )
                    tool_traces.append(
                        ToolCallTrace(
                            id=tool_call["id"],
                            name=name,
                            arguments=arguments,
                            response=retrieval_response,
                        )
                    )
                    self._record_message(
                        session_id=session_model.id,
                        role=models.ChatRole.TOOL,
                        content=tool_content,
                        tool_name=name,
                        tool_call_id=tool_call["id"],
                        tool_payload=retrieval_response,
                    )
                continue

            # Final assistant message
            content = message.get("content", "")
            reasoning_entries = message.get("reasoning_content")
            reasoning_payload = {"segments": reasoning_entries} if reasoning_entries else None
            assistant_msg = self._record_message(
                session_id=session_model.id,
                role=models.ChatRole.ASSISTANT,
                content=content,
                model=response.get("model"),
                reasoning=reasoning_payload,
                usage=usage,
            )
            session_model.context_tokens = usage_aggregate.get("total_tokens", usage.get("total_tokens", 0))
            session_model.updated_at = datetime.utcnow()
            self.session.add(session_model)
            self.session.commit()

            return ChatCompletionResponse(
                session=self._convert_session(session_model),
                messages=self._convert_messages(session_model.id),
                tool_traces=tool_traces,
                usage=usage_aggregate or usage,
                provider=provider,
                context_window=collection.context_window,
                context_consumed=session_model.context_tokens,
            )

        raise RuntimeError("LLM did not complete within the allowed tool iteration limit.")
