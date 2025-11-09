from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID, uuid4

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
        effort_value = (self.settings.openrouter_reasoning_effort or "").strip()
        self.reasoning_effort: Optional[str] = effort_value or None

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

    @staticmethod
    def _normalize_reasoning_segments(raw_reasoning: Any) -> List[Dict[str, Any]]:
        if raw_reasoning is None:
            return []
        if isinstance(raw_reasoning, str):
            stripped = raw_reasoning.strip()
            if not stripped:
                return []
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                return [{"type": "text", "content": stripped}]
            return ChatService._normalize_reasoning_segments(parsed)
        if isinstance(raw_reasoning, dict):
            return [raw_reasoning]
        if isinstance(raw_reasoning, list):
            normalized: List[Dict[str, Any]] = []
            for item in raw_reasoning:
                if isinstance(item, dict):
                    normalized.append(item)
                elif isinstance(item, str):
                    text_value = item.strip()
                    if text_value:
                        normalized.append({"type": "text", "content": text_value})
                else:
                    normalized.append({"type": "value", "content": item})
            return normalized
        return [{"type": "text", "content": str(raw_reasoning)}]

    @staticmethod
    def _ensure_arguments_string(arguments: Any) -> str:
        if isinstance(arguments, str):
            stripped = arguments.strip()
            if not stripped:
                return "{}"
            try:
                json.loads(stripped)
                return stripped
            except json.JSONDecodeError:
                return json.dumps({"input": stripped})
        if arguments is None:
            return "{}"
        return json.dumps(arguments)

    @staticmethod
    def _decode_tool_arguments(arguments: Any) -> Dict[str, Any]:
        if isinstance(arguments, dict):
            return arguments
        if isinstance(arguments, str):
            stripped = arguments.strip()
            if not stripped:
                return {}
            try:
                decoded = json.loads(stripped)
                if isinstance(decoded, dict):
                    return decoded
            except json.JSONDecodeError:
                return {"query": stripped}
        return {}

    @staticmethod
    def _build_reasoning_options(
        supported_parameters: Optional[List[str]],
        effort: Optional[str],
    ) -> Dict[str, Any]:
        if not supported_parameters:
            return {}
        normalized = {param.lower() for param in supported_parameters}
        options: Dict[str, Any] = {}
        if "include_reasoning" in normalized:
            options["include_reasoning"] = True
        if effort and "reasoning" in normalized:
            options["reasoning"] = {"effort": effort}
        return options

    def _reasoning_request_options(self, model_name: str) -> Dict[str, Any]:
        model_info = self.openrouter.get_model(model_name)
        supported = model_info.supported_parameters if model_info else []
        return self._build_reasoning_options(supported, self.reasoning_effort)

    @staticmethod
    def _normalize_tool_calls(
        tool_calls: List[Dict[str, Any]],
        processed_ids: Set[str],
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for call in tool_calls:
            function_payload = call.get("function") or {}
            if not isinstance(function_payload, dict):
                continue
            name = function_payload.get("name")
            if not name:
                continue
            arguments_str = ChatService._ensure_arguments_string(function_payload.get("arguments"))
            call_id = str(call.get("id") or f"tool_call_{uuid4().hex}")
            processed_ids.add(call_id)
            normalized.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments_str},
                }
            )
        return normalized

    @staticmethod
    def _extract_reasoning_tool_calls(
        reasoning_segments: List[Dict[str, Any]],
        processed_ids: Set[str],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        tool_calls: List[Dict[str, Any]] = []
        context: Dict[str, Dict[str, Any]] = {}
        candidate_types = {"tool_call", "tool_use", "tool_request", "call_tool", "function_call"}
        for segment in reasoning_segments:
            segment_type = str(segment.get("type") or "").lower()
            has_function = isinstance(segment.get("function"), dict)
            has_call = isinstance(segment.get("call"), dict)
            if not (segment_type in candidate_types or has_function or has_call):
                continue
            function_payload = segment.get("function") if has_function else {}
            if not isinstance(function_payload, dict):
                function_payload = {}
            call_payload = segment.get("call") if has_call else {}
            if not isinstance(call_payload, dict):
                call_payload = {}
            name = (
                function_payload.get("name")
                or call_payload.get("name")
                or segment.get("name")
                or segment.get("tool_name")
                or segment.get("function_name")
            )
            arguments_source = (
                function_payload.get("arguments")
                or call_payload.get("arguments")
                or call_payload.get("input")
                or segment.get("arguments")
                or segment.get("input")
                or segment.get("params")
                or segment.get("parameters")
            )
            if not name:
                continue
            call_id = str(
                segment.get("id")
                or segment.get("tool_call_id")
                or segment.get("call_id")
                or f"reasoning_tool_{uuid4().hex}"
            )
            if call_id in processed_ids:
                continue
            processed_ids.add(call_id)
            arguments_str = ChatService._ensure_arguments_string(arguments_source)
            tool_calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments_str},
                }
            )
            context[call_id] = segment
        return tool_calls, context

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
                if existing.collection_id != collection.id:
                    raise ValueError("Session does not belong to this collection.")
                return existing
            raise ValueError("Chat session not found.")
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

    def _apply_edit(
        self,
        *,
        session_model: models.ChatSession,
        target_message: models.ChatMessage,
        new_content: Optional[str],
    ) -> None:
        if target_message.session_id != session_model.id:
            raise ValueError("Message does not belong to this session.")

        if target_message.role == models.ChatRole.USER:
            trimmed = (new_content or "").strip()
            if not trimmed:
                raise ValueError("Edited message cannot be empty.")
            target_message.content = trimmed
            target_message.updated_at = datetime.utcnow()
            self.session.add(target_message)
            self.session.flush()
            self.chat_repo.delete_messages_after(
                session_id=session_model.id,
                created_at=target_message.created_at,
                include_anchor=False,
            )
        else:
            self.chat_repo.delete_messages_after(
                session_id=session_model.id,
                created_at=target_message.created_at,
                include_anchor=True,
            )
        session_model.updated_at = datetime.utcnow()
        self.session.add(session_model)
        self.session.flush()

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
        edit_target: Optional[models.ChatMessage] = None
        if payload.edit_message_id:
            edit_target = self.chat_repo.get_message(payload.edit_message_id, user_id=user.id)
            if not edit_target:
                raise ValueError("Message not found for editing.")
            session_model = self.chat_repo.get_session(edit_target.session_id, user_id=user.id)
            if not session_model:
                raise ValueError("Chat session not found for edit.")
            if session_model.collection_id != collection.id:
                raise ValueError("Message belongs to a different collection.")
        else:
            session_model = self._ensure_session(user=user, collection=collection, payload=payload)

        if edit_target:
            self._apply_edit(
                session_model=session_model,
                target_message=edit_target,
                new_content=payload.content,
            )
        else:
            trimmed_content = (payload.content or "").strip()
            if not trimmed_content:
                raise ValueError("Message content cannot be empty.")
            self._record_message(
                session_id=session_model.id,
                role=models.ChatRole.USER,
                content=trimmed_content,
            )

        history = self.chat_repo.list_messages(session_model.id)
        messages = [{"role": "system", "content": self._system_prompt(collection)}]
        for msg in history:
            messages.append(self._serialize_message(msg))

        tools = self._tool_spec(collection)
        tool_traces: List[ToolCallTrace] = []
        usage_aggregate: Dict[str, int] = {}
        provider = "openrouter"
        reasoning_trace: List[Dict[str, Any]] = []
        processed_reasoning_calls: Set[str] = set()
        reasoning_call_segments: Dict[str, Dict[str, Any]] = {}
        reasoning_options = self._reasoning_request_options(collection.chat_model)

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
                extra_body=reasoning_options or None,
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

            reasoning_segments = self._normalize_reasoning_segments(message.get("reasoning_content"))
            if reasoning_segments:
                reasoning_trace.extend(reasoning_segments)

            base_tool_calls = self._normalize_tool_calls(message.get("tool_calls") or [], processed_reasoning_calls)
            reasoning_tool_calls, reasoning_context = self._extract_reasoning_tool_calls(
                reasoning_segments, processed_reasoning_calls
            )
            if reasoning_context:
                reasoning_call_segments.update(reasoning_context)
            pending_tool_calls = base_tool_calls + reasoning_tool_calls
            if pending_tool_calls:
                assistant_content = message.get("content")
                if isinstance(assistant_content, list):
                    assistant_content = json.dumps(assistant_content)
                messages.append(
                    {
                        "role": "assistant",
                        "content": assistant_content or "",
                        "tool_calls": pending_tool_calls,
                    }
                )
                for tool_call in pending_tool_calls:
                    function_block = tool_call.get("function") or {}
                    if not isinstance(function_block, dict):
                        function_block = {}
                    name = function_block.get("name") or "tool_call"
                    arguments = self._decode_tool_arguments(function_block.get("arguments"))
                    query_text = arguments.get("query") or arguments.get("text") or payload.content
                    try:
                        top_k = int(arguments.get("top_k", 5))
                    except (TypeError, ValueError):
                        top_k = 5
                    top_k = max(1, min(10, top_k))
                    retrieval_response = self.retrieval.query_collection(collection, query_text, top_k=top_k)
                    tool_content = json.dumps(retrieval_response)
                    call_id = tool_call.get("id")
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": tool_content,
                        }
                    )
                    reasoning_segment = reasoning_call_segments.pop(call_id, None)
                    tool_traces.append(
                        ToolCallTrace(
                            id=call_id,
                            name=name,
                            arguments=arguments,
                            response=retrieval_response,
                            reasoning=reasoning_segment,
                        )
                    )
                    self._record_message(
                        session_id=session_model.id,
                        role=models.ChatRole.TOOL,
                        content=tool_content,
                        tool_name=name,
                        tool_call_id=call_id,
                        tool_payload=retrieval_response,
                    )
                continue

            # Final assistant message
            assistant_content = message.get("content")
            if isinstance(assistant_content, list):
                assistant_content = json.dumps(assistant_content)
            content = assistant_content or ""
            reasoning_payload = {"segments": reasoning_trace} if reasoning_trace else None
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
