from __future__ import annotations

import json
import math
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
from app.services.prompts import render_system_prompt
from app.services.retrieval import RetrievalService
from app.utils.time import utc_now


class ChatService:
    PARAMETER_TYPE_HINTS: Dict[str, str] = {
        "temperature": "float",
        "top_p": "float",
        "top_k": "int",
        "min_p": "float",
        "top_a": "float",
        "frequency_penalty": "float",
        "presence_penalty": "float",
        "repetition_penalty": "float",
        "max_tokens": "int",
        "seed": "int",
        "logit_bias": "dict",
        "logprobs": "bool",
        "top_logprobs": "int",
        "response_format": "dict",
        "structured_outputs": "bool",
        "stop": "list",
        "verbosity": "enum",
        "reasoning": "dict",
    }
    VERBOSITY_OPTIONS = {"low", "medium", "high"}
    REASONING_EFFORT_OPTIONS = {"minimal", "low", "medium", "high"}
    PROVIDER_ALLOWED_KEYS = {
        "order",
        "allow_fallbacks",
        "require_parameters",
        "data_collection",
        "zdr",
        "enforce_distillable_text",
        "only",
        "ignore",
        "quantizations",
        "sort",
        "max_price",
    }
    PROVIDER_KEY_ALIASES = {
        "allowfallbacks": "allow_fallbacks",
        "allow-fallbacks": "allow_fallbacks",
        "requireparameters": "require_parameters",
        "require-parameters": "require_parameters",
        "datacollection": "data_collection",
        "data-collection": "data_collection",
        "enforcedistillabletext": "enforce_distillable_text",
        "enforce-distillable-text": "enforce_distillable_text",
        "maxprice": "max_price",
    }
    PROVIDER_SORT_OPTIONS = {"price", "throughput", "latency"}
    PROVIDER_DATA_COLLECTION_OPTIONS = {"allow", "deny"}

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
    def _coerce_float_value(value: object) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    @staticmethod
    def _add_usage_value(aggregate: Dict[str, float], key: str, value: Optional[float]) -> None:
        if value is None:
            return
        aggregate[key] = aggregate.get(key, 0) + value

    @staticmethod
    def _extract_reasoning_tokens_from_usage(usage: Dict[str, Any]) -> Optional[int]:
        if not usage:
            return None
        direct = ChatService._coerce_usage_value(usage.get("reasoning_tokens"))
        if direct is not None:
            return direct
        details = usage.get("completion_tokens_details")
        if isinstance(details, dict):
            nested = ChatService._coerce_usage_value(details.get("reasoning_tokens"))
            if nested is not None:
                return nested
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
        selected_effort = ChatService._normalize_reasoning_effort(effort) or "medium"
        options: Dict[str, Any] = {}

        if not supported_parameters:
            options["reasoning"] = {"effort": selected_effort}
            return options

        normalized = {param.lower() for param in supported_parameters}

        if "reasoning" in normalized:
            options["reasoning"] = {"effort": selected_effort}
        elif "include_reasoning" in normalized:
            options["include_reasoning"] = True
        else:
            options["reasoning"] = {"effort": selected_effort}

        return options

    @staticmethod
    def _build_openrouter_body(
        reasoning_options: Optional[Dict[str, Any]],
        provider_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = dict(reasoning_options) if reasoning_options else {}
        usage_config = body.get("usage")
        if isinstance(usage_config, dict):
            merged_usage = dict(usage_config)
            merged_usage["include"] = True
            body["usage"] = merged_usage
        else:
            body["usage"] = {"include": True}
        if provider_options:
            body["provider"] = provider_options
        return body

    @staticmethod
    def _coerce_numeric_parameter(value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            number = float(value)
        elif isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            try:
                number = float(stripped)
            except ValueError:
                return None
        else:
            return None
        if not math.isfinite(number):
            return None
        return number

    @staticmethod
    def _coerce_bool_parameter(value: Any) -> Optional[bool]:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "on"}:
                return True
            if lowered in {"false", "0", "no", "off"}:
                return False
        return None

    @staticmethod
    def _coerce_dict_parameter(value: Any) -> Optional[Dict[str, Any]]:
        if value is None:
            return None
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            try:
                decoded = json.loads(stripped)
            except json.JSONDecodeError:
                return None
            if isinstance(decoded, dict):
                return decoded
        return None

    @staticmethod
    def _coerce_list_parameter(value: Any) -> Optional[List[str]]:
        if value is None:
            return None
        items: List[str] = []
        if isinstance(value, list):
            for item in value:
                if item is None:
                    continue
                if isinstance(item, str):
                    text = item.strip()
                    if text:
                        items.append(text)
                else:
                    items.append(str(item))
        elif isinstance(value, str):
            normalized = value.replace("\n", ",")
            for piece in normalized.split(","):
                text = piece.strip()
                if text:
                    items.append(text)
        else:
            items.append(str(value))
        return items or None

    @staticmethod
    def _normalize_reasoning_effort(value: Any) -> Optional[str]:
        if not value:
            return None
        if isinstance(value, str):
            lowered = value.strip().lower()
        else:
            lowered = str(value).strip().lower()
        return lowered if lowered in ChatService.REASONING_EFFORT_OPTIONS else None

    @classmethod
    def _prepare_reasoning_override(cls, raw: Any) -> Optional[Dict[str, Any]]:
        if raw is None:
            return None
        payload: Dict[str, Any]
        if isinstance(raw, dict):
            payload = raw
        else:
            normalized = cls._normalize_reasoning_effort(raw)
            if not normalized:
                return None
            payload = {"effort": normalized}
        prepared: Dict[str, Any] = {}
        for key, value in payload.items():
            normalized_key = str(key).lower()
            if normalized_key == "effort":
                effort_value = cls._normalize_reasoning_effort(value)
                if effort_value:
                    prepared["effort"] = effort_value
            elif normalized_key == "max_tokens":
                numeric_value = cls._coerce_numeric_parameter(value)
                if numeric_value is not None:
                    prepared["max_tokens"] = int(numeric_value)
            elif normalized_key in {"exclude", "enabled"}:
                bool_value = cls._coerce_bool_parameter(value)
                if bool_value is not None:
                    prepared[normalized_key] = bool_value
        return prepared or None

    @classmethod
    def _coerce_parameter_value(cls, key: str, value: Any) -> Optional[Any]:
        hint = cls.PARAMETER_TYPE_HINTS.get(key)
        if hint is None:
            return None
        if hint == "float":
            return cls._coerce_numeric_parameter(value)
        if hint == "int":
            number = cls._coerce_numeric_parameter(value)
            return None if number is None else int(number)
        if hint == "bool":
            return cls._coerce_bool_parameter(value)
        if hint == "dict":
            return cls._coerce_dict_parameter(value)
        if hint == "list":
            return cls._coerce_list_parameter(value)
        if hint == "enum":
            if isinstance(value, str):
                lowered = value.strip().lower()
            else:
                lowered = str(value).strip().lower()
            return lowered if lowered in cls.VERBOSITY_OPTIONS else None
        return None

    @classmethod
    def _sanitize_parameter_overrides(
        cls,
        raw: Optional[Dict[str, Any]],
        supported_parameters: Optional[List[str]],
    ) -> Dict[str, Any]:
        if not raw or not supported_parameters:
            return {}
        supported_lookup = {param.lower(): param for param in supported_parameters}
        sanitized: Dict[str, Any] = {}
        for incoming_key, value in raw.items():
            normalized_key = incoming_key.lower()
            canonical_key = supported_lookup.get(normalized_key)
            if not canonical_key or normalized_key not in cls.PARAMETER_TYPE_HINTS:
                continue
            parsed = cls._coerce_parameter_value(normalized_key, value)
            if parsed is None:
                continue
            sanitized[canonical_key] = parsed
        return sanitized

    @classmethod
    def _normalize_provider_key(cls, key: str) -> Optional[str]:
        normalized = key.strip().lower().replace("-", "_")
        if normalized in cls.PROVIDER_ALLOWED_KEYS:
            return normalized
        return cls.PROVIDER_KEY_ALIASES.get(normalized)

    @staticmethod
    def _coerce_string_list(value: Any) -> Optional[List[str]]:
        if value is None:
            return None
        items: List[str] = []
        if isinstance(value, str):
            chunks = value.replace("\n", ",").split(",")
            for chunk in chunks:
                trimmed = chunk.strip()
                if trimmed:
                    items.append(trimmed)
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                if item is None:
                    continue
                trimmed = str(item).strip()
                if trimmed:
                    items.append(trimmed)
        return items or None

    @classmethod
    def _coerce_provider_sort(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        candidate = str(value).strip().lower()
        if candidate in cls.PROVIDER_SORT_OPTIONS:
            return candidate
        return None

    @classmethod
    def _coerce_data_collection(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        candidate = str(value).strip().lower()
        if candidate in cls.PROVIDER_DATA_COLLECTION_OPTIONS:
            return candidate
        return None

    @classmethod
    def _coerce_max_price(cls, value: Any) -> Optional[Dict[str, float]]:
        if not isinstance(value, dict):
            return None
        parsed: Dict[str, float] = {}
        for key in ("prompt", "completion", "request", "image"):
            if key not in value:
                continue
            number = cls._coerce_numeric_parameter(value.get(key))
            if number is None:
                continue
            parsed[key] = float(number)
        return parsed or None

    @classmethod
    def _sanitize_provider_preferences(cls, raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not raw:
            return None
        normalized_input: Dict[str, Any] = {}
        for incoming_key, incoming_value in raw.items():
            if not isinstance(incoming_key, str):
                continue
            canonical_key = cls._normalize_provider_key(incoming_key)
            if canonical_key:
                normalized_input[canonical_key] = incoming_value
        if not normalized_input:
            return None

        sanitized: Dict[str, Any] = {}
        for list_key in ("order", "only", "ignore", "quantizations"):
            parsed_list = cls._coerce_string_list(normalized_input.get(list_key))
            if parsed_list:
                sanitized[list_key] = parsed_list
        for bool_key in ("allow_fallbacks", "require_parameters", "zdr", "enforce_distillable_text"):
            bool_value = cls._coerce_bool_parameter(normalized_input.get(bool_key))
            if bool_value is not None:
                sanitized[bool_key] = bool_value

        sort_value = cls._coerce_provider_sort(normalized_input.get("sort"))
        if sort_value:
            sanitized["sort"] = sort_value

        data_collection_value = cls._coerce_data_collection(normalized_input.get("data_collection"))
        if data_collection_value:
            sanitized["data_collection"] = data_collection_value

        max_price_value = cls._coerce_max_price(normalized_input.get("max_price"))
        if max_price_value:
            sanitized["max_price"] = max_price_value

        return sanitized or None

    def _reasoning_request_options(
        self,
        model_name: str,
        model_info: Optional["ModelInfo"] = None,
        reasoning_override: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        info = model_info or self.openrouter.get_model(model_name)
        supported = info.supported_parameters if info else []
        override_effort = reasoning_override.get("effort") if reasoning_override else None
        options = self._build_reasoning_options(supported, override_effort or self.reasoning_effort)
        if reasoning_override and "reasoning" in options:
            options["reasoning"].update(reasoning_override)
        return options

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
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
        tool_calls: List[Dict[str, Any]] = []
        context: Dict[str, Dict[str, Any]] = {}
        residual_segments: List[Dict[str, Any]] = []
        candidate_types = {"tool_call", "tool_use", "tool_request", "call_tool", "function_call"}
        pending_context: List[Dict[str, Any]] = []
        for segment in reasoning_segments:
            pending_context.append(segment)
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
                or call_payload.get("id")
                or function_payload.get("id")
                or f"reasoning_tool_{uuid4().hex}"
            )
            arguments_str = ChatService._ensure_arguments_string(arguments_source)
            if call_id not in processed_ids:
                processed_ids.add(call_id)
                tool_calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": arguments_str},
                    }
                )
            if call_id in context and "segments" in context[call_id]:
                context[call_id]["segments"].extend(pending_context)
            else:
                context[call_id] = {"segments": list(pending_context)}
            pending_context = []
        if pending_context:
            residual_segments.extend(pending_context)
        return tool_calls, context, residual_segments

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
            return self._create_session(
                user=user,
                collection=collection,
                payload=payload,
                session_id=payload.session_id,
            )
        return self._create_session(user=user, collection=collection, payload=payload)

    def _create_session(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        payload: ChatMessageCreate,
        session_id: Optional[UUID] = None,
    ) -> models.ChatSession:
        base_title = payload.title or (payload.content[:60] if payload.content else None)
        fallback_title = f"Chat {utc_now().strftime('%H:%M:%S')}"
        preferred_model = (payload.chat_model or "").strip() or collection.chat_model
        session_model = models.ChatSession(
            id=session_id or uuid4(),
            user_id=user.id,
            collection_id=collection.id,
            title=base_title or fallback_title,
            mode=payload.mode,
            chat_model=preferred_model,
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
            usage=usage_payload or None,
            created_at=utc_now(),
            updated_at=utc_now(),
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
            target_message.updated_at = utc_now()
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
        session_model.updated_at = utc_now()
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

        requested_model = (payload.chat_model or "").strip() or None
        if requested_model and requested_model != session_model.chat_model:
            session_model.chat_model = requested_model
            self.session.add(session_model)
            self.session.flush()

        active_model_name = session_model.chat_model or collection.chat_model
        if not active_model_name:
            raise ValueError("This collection does not have a chat model configured.")

        history = self.chat_repo.list_messages(session_model.id)
        system_prompt = render_system_prompt(collection, user)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            messages.append(self._serialize_message(msg))

        tools = self._tool_spec(collection)
        tool_traces: List[ToolCallTrace] = []
        usage_aggregate: Dict[str, float] = {}
        latest_usage_payload: Dict[str, Any] = {}
        provider = "openrouter"
        reasoning_trace: List[Dict[str, Any]] = []
        processed_reasoning_calls: Set[str] = set()
        reasoning_call_segments: Dict[str, Dict[str, Any]] = {}
        model_info = self.openrouter.get_model(active_model_name)
        if not model_info:
            raise ValueError("Selected model is not available on OpenRouter.")
        supported_parameters = model_info.supported_parameters if model_info.supported_parameters else []
        tool_supported = any(param.lower() == "tools" for param in supported_parameters)
        if not tool_supported:
            raise ValueError("Selected model does not support tool calls required for retrieval.")
        parameter_overrides = self._sanitize_parameter_overrides(payload.parameters, supported_parameters)
        reasoning_override = self._prepare_reasoning_override(parameter_overrides.pop("reasoning", None))
        reasoning_options = self._reasoning_request_options(
            active_model_name,
            model_info,
            reasoning_override,
        )
        provider_preferences = self._sanitize_provider_preferences(payload.provider)
        context_window = model_info.context_length or collection.context_window

        max_iterations = 48
        iteration = 0
        final_response: Optional[Dict[str, object]] = None

        while iteration < max_iterations:
            iteration += 1
            extra_body = self._build_openrouter_body(reasoning_options, provider_preferences)
            response = self.openrouter.chat(
                messages=messages,
                tools=tools,
                model=active_model_name,
                parallel_tool_calls=True,
                extra_body=extra_body,
                parameters=parameter_overrides or None,
            )
            final_response = response
            choice = response["choices"][0]
            message = choice.get("message", {})
            finish_reason = choice.get("finish_reason")
            usage = response.get("usage") or {}
            provider = response.get("provider", provider)

            if usage:
                latest_usage_payload = usage
                prompt_tokens = self._coerce_usage_value(usage.get("prompt_tokens"))
                completion_tokens = self._coerce_usage_value(usage.get("completion_tokens"))
                total_tokens = self._coerce_usage_value(usage.get("total_tokens"))
                reasoning_tokens = self._extract_reasoning_tokens_from_usage(usage)
                cost_value = self._coerce_float_value(usage.get("cost"))
                self._add_usage_value(usage_aggregate, "prompt_tokens", prompt_tokens)
                self._add_usage_value(usage_aggregate, "completion_tokens", completion_tokens)
                self._add_usage_value(usage_aggregate, "total_tokens", total_tokens)
                self._add_usage_value(usage_aggregate, "reasoning_tokens", reasoning_tokens)
                self._add_usage_value(usage_aggregate, "cost", cost_value)

            # Extract reasoning from the reasoning field (new format)
            reasoning_content = message.get("reasoning")
            if not reasoning_content:
                # Fallback to reasoning_content for backwards compatibility
                reasoning_content = message.get("reasoning_content")
            
            reasoning_segments = self._normalize_reasoning_segments(reasoning_content)
            base_tool_calls = self._normalize_tool_calls(message.get("tool_calls") or [], processed_reasoning_calls)
            reasoning_tool_calls, reasoning_context, residual_reasoning = self._extract_reasoning_tool_calls(
                reasoning_segments, processed_reasoning_calls
            )
            pending_tool_calls = base_tool_calls + reasoning_tool_calls
            shared_tool_reasoning: Optional[Dict[str, Any]] = None
            if pending_tool_calls:
                if reasoning_context:
                    reasoning_call_segments.update(reasoning_context)
                elif reasoning_segments:
                    shared_tool_reasoning = {"segments": reasoning_segments}
            elif reasoning_segments:
                reasoning_trace.extend(residual_reasoning or reasoning_segments)
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
                    tool_payload = {
                        "arguments": arguments,
                        "response": retrieval_response,
                    }
                    tool_content = json.dumps(tool_payload)
                    call_id = tool_call.get("id")
                    reasoning_segment = reasoning_call_segments.pop(call_id, None)
                    if reasoning_segment is None and shared_tool_reasoning:
                        reasoning_segment = shared_tool_reasoning
                    reasoning_payload = None
                    if reasoning_segment:
                        if "segments" not in reasoning_segment:
                            reasoning_payload = {"segments": [reasoning_segment]}
                        else:
                            reasoning_payload = reasoning_segment
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": tool_content,
                        }
                    )
                    tool_traces.append(
                        ToolCallTrace(
                            id=call_id,
                            name=name,
                            arguments=arguments,
                            response=retrieval_response,
                            reasoning=reasoning_payload,
                        )
                    )
                    self._record_message(
                        session_id=session_model.id,
                        role=models.ChatRole.TOOL,
                        content=tool_content,
                        tool_name=name,
                        tool_call_id=call_id,
                        tool_payload=tool_payload,
                        reasoning=reasoning_payload,
                    )
                continue

            # Final assistant message
            assistant_content = message.get("content")
            if isinstance(assistant_content, list):
                assistant_content = json.dumps(assistant_content)
            content = assistant_content or ""
            reasoning_payload = {"segments": reasoning_trace} if reasoning_trace else None
            latest_usage_source = latest_usage_payload or usage or {}
            latest_usage_total = self._coerce_usage_value(latest_usage_source.get("total_tokens"))
            final_usage: Dict[str, Any] = dict(latest_usage_payload or usage or {})
            if usage_aggregate:
                final_usage = dict(final_usage) if final_usage else {}
                final_usage.update({key: value for key, value in usage_aggregate.items() if value is not None})
            assistant_msg = self._record_message(
                session_id=session_model.id,
                role=models.ChatRole.ASSISTANT,
                content=content,
                model=response.get("model"),
                reasoning=reasoning_payload,
                usage=final_usage,
            )
            session_model.context_tokens = (
                latest_usage_total
                if latest_usage_total is not None
                else usage_aggregate.get("total_tokens", 0)
            )
            session_model.updated_at = utc_now()
            self.session.add(session_model)
            self.session.commit()

            return ChatCompletionResponse(
                session=self._convert_session(session_model),
                messages=self._convert_messages(session_model.id),
                tool_traces=tool_traces,
                usage=final_usage,
                provider=provider,
                context_window=context_window,
                context_consumed=session_model.context_tokens,
            )

        raise RuntimeError("LLM did not complete within the allowed tool iteration limit.")
