"""Chat service orchestration for sessions, tools, and streaming."""

from __future__ import annotations

import json
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.chat.persistence.records import (
    MessageRecord,
    RecordContext,
    ToolCallRecord,
    convert_messages,
    convert_session,
    record_message,
    record_partial_assistant_message,
    record_tool_call_assistant_message,
    serialize_message,
)
from app.chat.persistence.sessions import SessionRequest, apply_edit, ensure_session
from app.chat.processing.parameters import (
    build_openrouter_body,
    build_reasoning_options,
    prepare_reasoning_override,
    sanitize_parameter_overrides,
    sanitize_provider_preferences,
)
from app.chat.processing.reasoning import normalize_reasoning_segments
from app.chat.processing.tool_calls import (
    decode_tool_arguments,
    extract_reasoning_tool_calls,
    normalize_tool_calls,
)
from app.chat.processing.usage import (
    add_usage_value,
    coerce_float_value,
    coerce_usage_value,
    extract_reasoning_tokens_from_usage,
)
from app.chat.providers.base import ChatProvider, ChatRequest
from app.chat.providers.openrouter import OpenRouterProvider
from app.chat.state import (
    ChatSetup,
    ModelSettings,
    PipelineContext,
    ProviderResponse,
    RunState,
    StreamIterationResult,
    StreamToolCallContext,
    ToolCallResolution,
    ToolCollectionContext,
    ToolExecutionContext,
)
from app.chat.streaming.streaming import stream_model_completion
from app.clients.openrouter import OpenRouterClient, get_openrouter_client
from app.core.config import get_settings
from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository
from app.pipelines.config import resolve_ingestion_settings, resolve_retrieval_settings
from app.schemas.chat import (
    ChatBranchResponse,
    ChatCompletionResponse,
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionRead,
    ToolCallTrace,
)
from app.services.pipelines import PipelineService
from app.services.prompts import (
    collection_tool_name,
    get_system_prompt_template,
    render_system_prompt,
    system_prompt_context,
)
from app.services.retrieval import RetrievalService
from app.utils.time import utc_now


@dataclass
class StreamCapture:
    """Track partial stream state for abort handling."""

    content_parts: list[str] = field(default_factory=list)
    reasoning_segments: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class SessionPreferencesUpdate:
    """Normalized run settings persisted for sessions and users."""

    parameter_overrides: dict[str, Any] | None
    provider_preferences: dict[str, Any] | None
    stream_enabled: bool
    tool_collection_ids: list[UUID]


class ChatService:
    """Manage chat sessions, tool calls, and provider interactions."""

    MAX_TOOL_ITERATIONS = 48

    def __init__(self, session: Session) -> None:
        """Initialize the chat service with database and provider clients."""
        self.session = session
        self.settings = get_settings()
        self.chat_repo = ChatRepository(session)
        self.collection_repo = CollectionRepository(session)
        self.openrouter: OpenRouterClient | None = None
        self.provider: ChatProvider | None = None
        self.retrieval = RetrievalService(session)
        effort_value = (self.settings.openrouter_reasoning_effort or "").strip()
        self.reasoning_effort: str | None = effort_value or None

    def _ensure_provider(self, user: models.User) -> ChatProvider:
        """Return the provider client for the current user."""
        current = getattr(self, "provider", None)
        if current is not None:
            return current
        client = getattr(self, "openrouter", None)
        if client is None:
            client = get_openrouter_client(user.openrouter_api_key or "")
            self.openrouter = client
        provider = OpenRouterProvider(client)
        self.provider = provider
        return provider

    def _resolve_pipeline_context(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> PipelineContext:
        """Resolve ingestion and retrieval pipeline settings for a collection."""
        pipeline_service = PipelineService(self.session)
        defaults = pipeline_service.ensure_default_pipelines(user)
        pipeline_service.ensure_collection_pipelines(collection, defaults)
        ingestion_pipeline_id = collection.ingestion_pipeline_id or defaults.ingestion.id
        retrieval_pipeline_id = collection.retrieval_pipeline_id or defaults.retrieval.id
        ingestion_pipeline = pipeline_service.get_pipeline(ingestion_pipeline_id, user.id)
        retrieval_pipeline = pipeline_service.get_pipeline(retrieval_pipeline_id, user.id)
        if not ingestion_pipeline or not retrieval_pipeline:
            raise ValueError("Pipeline configuration could not be resolved.")
        ingestion_definition = pipeline_service.get_definition(ingestion_pipeline)
        retrieval_definition = pipeline_service.get_definition(retrieval_pipeline)
        ingestion_settings = resolve_ingestion_settings(ingestion_definition, collection)
        retrieval_settings = resolve_retrieval_settings(retrieval_definition, collection)
        return PipelineContext(
            ingestion_settings=ingestion_settings,
            retrieval_settings=retrieval_settings,
        )

    def _build_tool_collection_context(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> ToolCollectionContext:
        """Build tool context for a collection."""
        pipeline = self._resolve_pipeline_context(user, collection)
        return ToolCollectionContext(
            collection=collection,
            tool_name=collection_tool_name(collection.id),
            ingestion_settings=pipeline.ingestion_settings,
            retrieval_settings=pipeline.retrieval_settings,
        )

    def _resolve_tool_collections(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
        session_model: models.ChatSession | None,
    ) -> tuple[list[ToolCollectionContext], list[UUID]]:
        """Resolve tool collections for the request payload."""
        if payload.tool_collection_ids is None:
            if not session_model:
                collection_ids: list[UUID] = []
            else:
                collection_ids = self.chat_repo.list_session_collection_ids(session_model.id)
        else:
            seen: set[UUID] = set()
            collection_ids = []
            for raw_id in payload.tool_collection_ids:
                if raw_id in seen:
                    continue
                seen.add(raw_id)
                collection_ids.append(raw_id)

        if not collection_ids:
            return [], []

        if not (user.pinecone_api_key or "").strip():
            raise ValueError(
                "Pinecone API key is not configured. Update it in Settings to enable tools."
            )

        collections = self.collection_repo.list_by_ids(user.id, collection_ids)
        collection_map = {collection.id: collection for collection in collections}
        missing = [
            str(collection_id)
            for collection_id in collection_ids
            if collection_id not in collection_map
        ]
        if missing:
            raise ValueError("Selected collections are not available.")
        ordered = [collection_map[collection_id] for collection_id in collection_ids]
        contexts = [self._build_tool_collection_context(user, collection) for collection in ordered]
        return contexts, collection_ids

    def _resolve_session_model(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
        default_chat_model: str,
        primary_collection_id: UUID | None,
    ) -> tuple[models.ChatSession, models.ChatMessage | None]:
        """Resolve the chat session for the request payload."""
        if payload.edit_message_id:
            edit_target = self.chat_repo.get_message(payload.edit_message_id, user_id=user.id)
            if not edit_target:
                raise ValueError("Message not found for editing.")
            session_model = self.chat_repo.get_session(edit_target.session_id, user_id=user.id)
            if not session_model:
                raise ValueError("Chat session not found for edit.")
            return session_model, edit_target

        session_request = SessionRequest(
            chat_repo=self.chat_repo,
            session=self.session,
            user=user,
            payload=payload,
            default_chat_model=default_chat_model,
            primary_collection_id=primary_collection_id,
        )
        session_model = ensure_session(session_request)
        return session_model, None

    @staticmethod
    def _resolve_branch_title(session_title: str, requested_title: str | None) -> str:
        """Return the new session title for a branched chat."""
        trimmed_title = (requested_title or "").strip()
        if trimmed_title:
            return trimmed_title
        base_title = session_title or "Chat"
        return f"Branch of {base_title}"

    def _copy_branch_messages(
        self,
        *,
        branch_session_id: UUID,
        messages: list[models.ChatMessage],
    ) -> list[models.ChatMessage]:
        """Copy messages into a branched session, preserving source links."""
        branched_messages: list[models.ChatMessage] = []
        for message in messages:
            branched_message = models.ChatMessage(
                session_id=branch_session_id,
                role=message.role,
                content=message.content,
                model=message.model,
                tool_name=message.tool_name,
                tool_call_id=message.tool_call_id,
                tool_payload=message.tool_payload,
                reasoning_trace=message.reasoning_trace,
                prompt_tokens=message.prompt_tokens,
                completion_tokens=message.completion_tokens,
                usage=message.usage,
                source_message_id=message.id,
                created_at=message.created_at,
                updated_at=message.updated_at,
            )
            self.chat_repo.add_message(branched_message)
            branched_messages.append(branched_message)
        return branched_messages

    def branch_session(
        self,
        *,
        user: models.User,
        session_id: UUID,
        message_id: UUID,
        title: str | None,
    ) -> ChatBranchResponse:
        """Create a new chat session branched from a specific message."""
        session_model = self.chat_repo.get_session(session_id, user_id=user.id)
        if not session_model:
            raise ValueError("Chat session not found.")
        target_message = self.chat_repo.get_message(message_id, user_id=user.id)
        if not target_message:
            raise ValueError("Message not found for branching.")
        if target_message.session_id != session_model.id:
            raise ValueError("Message does not belong to this session.")

        messages = self.chat_repo.list_messages(session_model.id, limit=None)
        target_index = next(
            (index for index, message in enumerate(messages) if message.id == target_message.id),
            -1,
        )
        if target_index < 0:
            raise ValueError("Message not found in session history.")
        branch_title = self._resolve_branch_title(session_model.title, title)
        branched_session = models.ChatSession(
            user_id=user.id,
            collection_id=session_model.collection_id,
            title=branch_title,
            mode=session_model.mode,
            chat_model=session_model.chat_model,
            context_tokens=0,
            parameter_overrides=session_model.parameter_overrides,
            provider_preferences=session_model.provider_preferences,
            stream=session_model.stream,
            branched_from_session_id=session_model.id,
            branched_from_message_id=target_message.id,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.chat_repo.add_session(branched_session)
        tool_collection_ids = self.chat_repo.list_session_collection_ids(session_model.id)
        if tool_collection_ids:
            self.chat_repo.replace_session_collections(
                session_id=branched_session.id,
                collection_ids=tool_collection_ids,
            )

        branched_messages = self._copy_branch_messages(
            branch_session_id=branched_session.id,
            messages=messages[: target_index + 1],
        )

        self.session.commit()
        return ChatBranchResponse(
            session=ChatSessionRead.from_model(
                branched_session,
                tool_collection_ids=tool_collection_ids,
            ),
            messages=[ChatMessageRead.from_model(msg) for msg in branched_messages],
        )

    def _apply_payload_to_session(
        self,
        *,
        session_model: models.ChatSession,
        edit_target: models.ChatMessage | None,
        payload: ChatMessageCreate,
    ) -> None:
        """Apply an edit or append a user message to the session."""
        if edit_target:
            apply_edit(
                session=self.session,
                chat_repo=self.chat_repo,
                session_model=session_model,
                target_message=edit_target,
                new_content=payload.content,
            )
            return

        trimmed_content = (payload.content or "").strip()
        if not trimmed_content:
            raise ValueError("Message content cannot be empty.")
        record_message(
            RecordContext(session=self.session, chat_repo=self.chat_repo),
            MessageRecord(
                session_id=session_model.id,
                role=models.ChatRole.USER,
                content=trimmed_content,
            ),
        )

    def _maybe_update_session_model(
        self,
        *,
        session_model: models.ChatSession,
        payload: ChatMessageCreate,
    ) -> None:
        """Update the session model if a new model was requested."""
        requested_model = (payload.chat_model or "").strip() or None
        if requested_model and requested_model != session_model.chat_model:
            session_model.chat_model = requested_model
            self.session.add(session_model)
            self.session.flush()

    def _persist_session_preferences(
        self,
        *,
        session_model: models.ChatSession,
        user: models.User,
        preferences: SessionPreferencesUpdate,
    ) -> None:
        """Persist session and user-level run settings for future chats."""
        parameter_overrides = preferences.parameter_overrides or None
        provider_preferences = preferences.provider_preferences or None
        session_model.parameter_overrides = parameter_overrides
        session_model.provider_preferences = provider_preferences
        session_model.stream = preferences.stream_enabled
        user.last_used_chat_model = session_model.chat_model
        user.last_used_parameters = parameter_overrides
        user.last_used_provider = provider_preferences
        user.last_used_stream = preferences.stream_enabled
        user.last_used_tool_collection_ids = [
            str(collection_id) for collection_id in preferences.tool_collection_ids
        ]
        self.session.add(session_model)
        self.session.add(user)
        self.session.flush()

    def _build_message_history(
        self,
        *,
        user: models.User,
        session_model: models.ChatSession,
        tool_collections: list[ToolCollectionContext],
    ) -> list[dict[str, Any]]:
        """Build the message history with the system prompt."""
        history = self.chat_repo.list_messages(session_model.id)
        tool_contexts: list[dict[str, object]] = []
        for tool_context in tool_collections:
            template = get_system_prompt_template(tool_context.collection)
            context = system_prompt_context(
                tool_context.collection,
                user,
                ingestion_settings=tool_context.ingestion_settings,
                retrieval_settings=tool_context.retrieval_settings,
                tool_name=tool_context.tool_name,
            )
            tool_contexts.append({"template": template, "context": context})
        system_prompt = render_system_prompt(tool_contexts, user)
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            messages.append(serialize_message(msg))
        return messages

    def _build_reasoning_request_options(
        self,
        supported_parameters: list[str],
        reasoning_override: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """Build reasoning options for the current model."""
        override_effort = reasoning_override.get("effort") if reasoning_override else None
        options = build_reasoning_options(
            supported_parameters,
            override_effort or self.reasoning_effort,
        )
        if reasoning_override and "reasoning" in options:
            options["reasoning"].update(reasoning_override)
        return options

    # pylint: disable=too-many-arguments,too-many-locals
    def _prepare_model_settings(
        self,
        *,
        provider: ChatProvider,
        payload: ChatMessageCreate,
        session_model: models.ChatSession,
        default_chat_model: str,
        fallback_context_window: int,
        tools_enabled: bool,
    ) -> ModelSettings:
        """Resolve model settings, parameters, and preferences."""
        active_model_name = session_model.chat_model or default_chat_model
        if not active_model_name:
            raise ValueError("No chat model is configured for this session.")
        model_info = provider.get_model(active_model_name)
        if not model_info:
            raise ValueError("Selected model is not available on OpenRouter.")
        supported_parameters = model_info.supported_parameters or []
        tool_supported = any(param.lower() == "tools" for param in supported_parameters)
        if tools_enabled and not tool_supported:
            raise ValueError("Selected model does not support tool calls required for retrieval.")
        parameter_overrides = sanitize_parameter_overrides(
            payload.parameters,
            supported_parameters,
        )
        reasoning_override = prepare_reasoning_override(parameter_overrides.pop("reasoning", None))
        reasoning_options = self._build_reasoning_request_options(
            supported_parameters,
            reasoning_override,
        )
        provider_preferences = sanitize_provider_preferences(payload.provider)
        context_window = model_info.context_length or fallback_context_window
        return ModelSettings(
            active_model_name=active_model_name,
            model_info=model_info,
            supported_parameters=supported_parameters,
            parameter_overrides=parameter_overrides,
            reasoning_options=reasoning_options,
            provider_preferences=provider_preferences,
            context_window=context_window,
        )

    # pylint: disable=too-many-locals
    def _prepare_chat_setup(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
        provider: ChatProvider,
    ) -> ChatSetup:
        """Prepare shared context needed for chat execution."""
        seed_tool_contexts, _ = self._resolve_tool_collections(
            user=user,
            payload=payload,
            session_model=None,
        )
        primary_context = seed_tool_contexts[0] if seed_tool_contexts else None
        default_chat_model = (
            primary_context.retrieval_settings.chat_model
            if primary_context and primary_context.retrieval_settings.chat_model
            else self.settings.default_chat_model
        )
        fallback_context_window = (
            primary_context.retrieval_settings.context_window if primary_context else 0
        )
        session_model, edit_target = self._resolve_session_model(
            user=user,
            payload=payload,
            default_chat_model=default_chat_model,
            primary_collection_id=primary_context.collection.id if primary_context else None,
        )
        tool_collections, tool_collection_ids = self._resolve_tool_collections(
            user=user,
            payload=payload,
            session_model=session_model,
        )
        if not seed_tool_contexts and tool_collections:
            fallback_context_window = tool_collections[0].retrieval_settings.context_window
        if payload.tool_collection_ids is not None:
            self.chat_repo.replace_session_collections(
                session_id=session_model.id,
                collection_ids=tool_collection_ids,
            )
            session_model.collection_id = tool_collection_ids[0] if tool_collection_ids else None
            self.session.add(session_model)
            self.session.flush()
        self._apply_payload_to_session(
            session_model=session_model,
            edit_target=edit_target,
            payload=payload,
        )
        self._maybe_update_session_model(session_model=session_model, payload=payload)
        messages = self._build_message_history(
            user=user,
            session_model=session_model,
            tool_collections=tool_collections,
        )
        tools, tool_collection_map = self._tool_specs(tool_collections)
        model_settings = self._prepare_model_settings(
            provider=provider,
            payload=payload,
            session_model=session_model,
            default_chat_model=default_chat_model,
            fallback_context_window=fallback_context_window,
            tools_enabled=bool(tool_collections),
        )
        self._persist_session_preferences(
            session_model=session_model,
            user=user,
            preferences=SessionPreferencesUpdate(
                parameter_overrides=model_settings.parameter_overrides or None,
                provider_preferences=model_settings.provider_preferences or None,
                stream_enabled=bool(payload.stream),
                tool_collection_ids=tool_collection_ids,
            ),
        )
        return ChatSetup(
            session_model=session_model,
            messages=messages,
            tools=tools,
            tool_collections=tool_collections,
            tool_collection_map=tool_collection_map,
            pipeline=primary_context
            and PipelineContext(
                ingestion_settings=primary_context.ingestion_settings,
                retrieval_settings=primary_context.retrieval_settings,
            ),
            model=model_settings,
        )

    def _update_usage_aggregate(self, run_state: RunState, usage: dict[str, Any]) -> None:
        """Update usage aggregation with a new usage payload."""
        if not usage:
            return
        run_state.latest_usage_payload = usage
        prompt_tokens = coerce_usage_value(usage.get("prompt_tokens"))
        completion_tokens = coerce_usage_value(usage.get("completion_tokens"))
        total_tokens = coerce_usage_value(usage.get("total_tokens"))
        reasoning_tokens = extract_reasoning_tokens_from_usage(usage)
        cost_value = coerce_float_value(usage.get("cost"))
        add_usage_value(run_state.usage_aggregate, "prompt_tokens", prompt_tokens)
        add_usage_value(run_state.usage_aggregate, "completion_tokens", completion_tokens)
        add_usage_value(run_state.usage_aggregate, "total_tokens", total_tokens)
        add_usage_value(run_state.usage_aggregate, "reasoning_tokens", reasoning_tokens)
        add_usage_value(run_state.usage_aggregate, "cost", cost_value)

    def _resolve_tool_calls(
        self,
        *,
        message: dict[str, Any],
        run_state: RunState,
        combine_reasoning: bool,
    ) -> ToolCallResolution:
        """Normalize tool calls and reasoning for the current iteration."""
        reasoning_content = message.get("reasoning") or message.get("reasoning_content")
        reasoning_segments = normalize_reasoning_segments(reasoning_content)
        base_tool_calls = normalize_tool_calls(
            message.get("tool_calls") or [],
            run_state.processed_reasoning_calls,
        )
        reasoning_tool_calls, reasoning_context, residual_reasoning = extract_reasoning_tool_calls(
            reasoning_segments,
            run_state.processed_reasoning_calls,
        )
        if combine_reasoning:
            pending_tool_calls = base_tool_calls + reasoning_tool_calls
        else:
            pending_tool_calls = base_tool_calls or reasoning_tool_calls
        shared_tool_reasoning: dict[str, Any] | None = None
        if pending_tool_calls:
            if reasoning_context:
                run_state.reasoning_call_segments.update(reasoning_context)
            elif reasoning_segments:
                shared_tool_reasoning = {"segments": reasoning_segments}
        elif reasoning_segments:
            run_state.reasoning_trace.extend(residual_reasoning or reasoning_segments)
        return ToolCallResolution(
            pending_tool_calls=pending_tool_calls,
            shared_tool_reasoning=shared_tool_reasoning,
        )

    def _parse_tool_call(
        self,
        tool_call: dict[str, Any],
        payload: ChatMessageCreate,
        *,
        use_fallback_id: bool,
    ) -> tuple[str | None, str, dict[str, Any], str, int]:
        """Parse tool call metadata into a normalized tuple."""
        function_block = tool_call.get("function") or {}
        if not isinstance(function_block, dict):
            function_block = {}
        name = function_block.get("name") or "tool_call"
        arguments = decode_tool_arguments(function_block.get("arguments"))
        call_id = tool_call.get("id")
        if use_fallback_id and not call_id:
            call_id = f"tool_call_{uuid4().hex}"
        query_text = arguments.get("query") or arguments.get("text") or payload.content
        try:
            top_k = int(arguments.get("top_k", 5))
        except (TypeError, ValueError):
            top_k = 5
        top_k = max(1, min(10, top_k))
        return call_id, name, arguments, query_text, top_k

    def _select_tool_reasoning(
        self,
        *,
        call_id: str | None,
        run_state: RunState,
        shared_tool_reasoning: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Select reasoning entry for tool call events."""
        return run_state.reasoning_call_segments.get(call_id) or shared_tool_reasoning

    def _build_reasoning_payload(
        self,
        *,
        call_id: str | None,
        run_state: RunState,
        shared_tool_reasoning: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Build reasoning payload for tool call results."""
        reasoning_segment = run_state.reasoning_call_segments.pop(call_id, None)
        if reasoning_segment is None and shared_tool_reasoning:
            reasoning_segment = shared_tool_reasoning
        if not reasoning_segment:
            return None
        if "segments" not in reasoning_segment:
            return {"segments": [reasoning_segment]}
        return reasoning_segment

    def _append_tool_call_assistant_message(
        self,
        *,
        session_model: models.ChatSession,
        messages: list[dict[str, Any]],
        assistant_content: str | None,
        tool_calls: list[dict[str, Any]],
    ) -> None:
        """Append assistant tool-call message to history and persist it."""
        messages.append(
            {
                "role": "assistant",
                "content": assistant_content or "",
                "tool_calls": tool_calls,
            }
        )
        record_tool_call_assistant_message(
            context=RecordContext(session=self.session, chat_repo=self.chat_repo),
            session_model=session_model,
            content=assistant_content or "",
            tool_calls=tool_calls,
        )

    def _record_partial_stream_exit(
        self,
        *,
        capture: StreamCapture,
        setup: ChatSetup,
    ) -> None:
        """Persist partial assistant content when streaming is aborted."""
        partial_content = "".join(capture.content_parts)
        reasoning_segments = [
            dict(segment)
            for segment in capture.reasoning_segments
            if isinstance(segment, dict)
        ]
        record_partial_assistant_message(
            context=RecordContext(session=self.session, chat_repo=self.chat_repo),
            session_model=setup.session_model,
            content=partial_content,
            reasoning_segments=reasoning_segments,
            model=setup.model.active_model_name,
        )

    def _stream_tool_calls_if_needed(
        self,
        *,
        context: StreamToolCallContext,
    ) -> Generator[dict[str, Any], None, bool]:
        """Resolve and execute streaming tool calls if present."""
        resolution = self._resolve_tool_calls(
            message=context.message,
            run_state=context.run_state,
            combine_reasoning=True,
        )
        if not resolution.pending_tool_calls:
            return False
        assistant_content = context.message.get("content")
        if isinstance(assistant_content, list):
            assistant_content = json.dumps(assistant_content)
        self._append_tool_call_assistant_message(
            session_model=context.setup.session_model,
            messages=context.setup.messages,
            assistant_content=assistant_content,
            tool_calls=resolution.pending_tool_calls,
        )
        tool_context = ToolExecutionContext(
            user=context.user,
            payload=context.payload,
            session_model=context.setup.session_model,
            messages=context.setup.messages,
            run_state=context.run_state,
            shared_tool_reasoning=resolution.shared_tool_reasoning,
            tool_collection_map=context.setup.tool_collection_map,
        )
        yield from self._stream_tool_calls(
            tool_calls=resolution.pending_tool_calls,
            context=tool_context,
        )
        return True

    def _execute_tool_calls(
        self,
        *,
        tool_calls: list[dict[str, Any]],
        context: ToolExecutionContext,
    ) -> None:
        """Execute tool calls and persist the results."""
        for tool_call in tool_calls:
            call_id, name, arguments, query_text, top_k = self._parse_tool_call(
                tool_call,
                context.payload,
                use_fallback_id=True,
            )
            collection = self._select_tool_collection(
                tool_name=name,
                tool_map=context.tool_collection_map,
            )
            retrieval_response = self.retrieval.query_collection(
                context.user,
                collection,
                query_text,
                top_k=top_k,
            )
            response_payload = jsonable_encoder(retrieval_response)
            tool_payload = {
                "collection_id": str(collection.id),
                "collection_name": collection.name,
                "arguments": arguments,
                "response": response_payload,
            }
            tool_content = json.dumps(tool_payload)
            reasoning_payload = self._build_reasoning_payload(
                call_id=call_id,
                run_state=context.run_state,
                shared_tool_reasoning=context.shared_tool_reasoning,
            )
            context.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": tool_content,
                }
            )
            context.run_state.tool_traces.append(
                ToolCallTrace(
                    id=call_id,
                    name=name,
                    arguments=arguments,
                    response=response_payload,
                    reasoning=reasoning_payload,
                    collection_id=collection.id,
                    collection_name=collection.name,
                )
            )
            record_message(
                RecordContext(session=self.session, chat_repo=self.chat_repo),
                MessageRecord(
                    session_id=context.session_model.id,
                    role=models.ChatRole.TOOL,
                    content=tool_content,
                    tool=ToolCallRecord(
                        name=name,
                        call_id=call_id,
                        payload=tool_payload,
                    ),
                    reasoning=reasoning_payload,
                ),
            )

    # pylint: disable=too-many-locals
    def _stream_tool_calls(
        self,
        *,
        tool_calls: list[dict[str, Any]],
        context: ToolExecutionContext,
    ) -> Generator[dict[str, Any], None, None]:
        """Execute tool calls while emitting streaming events."""
        for tool_call in tool_calls:
            call_id, name, arguments, query_text, top_k = self._parse_tool_call(
                tool_call,
                context.payload,
                use_fallback_id=True,
            )
            collection = self._select_tool_collection(
                tool_name=name,
                tool_map=context.tool_collection_map,
            )
            reasoning_entry = self._select_tool_reasoning(
                call_id=call_id,
                run_state=context.run_state,
                shared_tool_reasoning=context.shared_tool_reasoning,
            )
            yield {
                "type": "tool_call",
                "id": call_id,
                "name": name,
                "arguments": arguments,
                "reasoning": reasoning_entry,
                "collection_id": str(collection.id),
                "collection_name": collection.name,
            }
            retrieval_response = self.retrieval.query_collection(
                context.user,
                collection,
                query_text,
                top_k=top_k,
            )
            response_payload = jsonable_encoder(retrieval_response)
            tool_payload = {
                "collection_id": str(collection.id),
                "collection_name": collection.name,
                "arguments": arguments,
                "response": response_payload,
            }
            tool_content = json.dumps(tool_payload)
            reasoning_payload = self._build_reasoning_payload(
                call_id=call_id,
                run_state=context.run_state,
                shared_tool_reasoning=context.shared_tool_reasoning,
            )
            yield {
                "type": "tool_result",
                "id": call_id,
                "name": name,
                "arguments": arguments,
                "response": retrieval_response,
                "reasoning": reasoning_payload,
                "collection_id": str(collection.id),
                "collection_name": collection.name,
            }
            context.messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": tool_content,
                }
            )
            context.run_state.tool_traces.append(
                ToolCallTrace(
                    id=call_id,
                    name=name,
                    arguments=arguments,
                    response=response_payload,
                    reasoning=reasoning_payload,
                    collection_id=collection.id,
                    collection_name=collection.name,
                )
            )
            record_message(
                RecordContext(session=self.session, chat_repo=self.chat_repo),
                MessageRecord(
                    session_id=context.session_model.id,
                    role=models.ChatRole.TOOL,
                    content=tool_content,
                    tool=ToolCallRecord(
                        name=name,
                        call_id=call_id,
                        payload=tool_payload,
                    ),
                    reasoning=reasoning_payload,
                ),
            )

    def _finalize_response(
        self,
        *,
        setup: ChatSetup,
        run_state: RunState,
        response: ProviderResponse,
    ) -> ChatCompletionResponse:
        """Persist the final assistant response and build API response."""
        assistant_content = response.message.get("content")
        if isinstance(assistant_content, list):
            assistant_content = json.dumps(assistant_content)
        content = assistant_content or ""
        reasoning_payload = None
        if run_state.reasoning_trace:
            reasoning_payload = {"segments": run_state.reasoning_trace}
        latest_usage_source = run_state.latest_usage_payload or response.usage or {}
        latest_usage_total = coerce_usage_value(latest_usage_source.get("total_tokens"))
        final_usage: dict[str, Any] = dict(run_state.latest_usage_payload or response.usage or {})
        if run_state.usage_aggregate:
            final_usage = dict(final_usage) if final_usage else {}
            final_usage.update(
                {
                    key: value
                    for key, value in run_state.usage_aggregate.items()
                    if value is not None
                }
            )
        assistant_msg = record_message(
            RecordContext(session=self.session, chat_repo=self.chat_repo),
            MessageRecord(
                session_id=setup.session_model.id,
                role=models.ChatRole.ASSISTANT,
                content=content,
                model=response.response_model_name,
                reasoning=reasoning_payload,
                usage=final_usage,
            ),
        )
        setup.messages.append(serialize_message(assistant_msg))
        setup.session_model.context_tokens = (
            latest_usage_total
            if latest_usage_total is not None
            else run_state.usage_aggregate.get("total_tokens", 0)
        )
        self.session.add(setup.session_model)
        self.session.commit()
        tool_collection_ids = [context.collection.id for context in setup.tool_collections]
        return ChatCompletionResponse(
            session=convert_session(
                setup.session_model,
                tool_collection_ids=tool_collection_ids,
            ),
            messages=convert_messages(chat_repo=self.chat_repo, session_id=setup.session_model.id),
            tool_traces=run_state.tool_traces,
            usage=final_usage,
            provider=run_state.provider,
            context_window=setup.model.context_window,
            context_consumed=setup.session_model.context_tokens,
        )

    def _stream_iteration(
        self,
        *,
        provider: ChatProvider,
        setup: ChatSetup,
        capture: StreamCapture,
    ) -> Generator[
        dict[str, Any],
        None,
        tuple[dict[str, Any], dict[str, Any], str, str | None, str | None],
    ]:
        """Run one streaming iteration and yield events."""
        request = ChatRequest(
            messages=setup.messages,
            tools=setup.tools or None,
            model=setup.model.active_model_name,
            extra_body=build_openrouter_body(
                setup.model.reasoning_options,
                setup.model.provider_preferences,
            ),
            parameters=setup.model.parameter_overrides or None,
        )
        stream = stream_model_completion(provider=provider, request=request)
        while True:
            try:
                event = next(stream)
            except StopIteration as stop:
                return stop.value
            if isinstance(event, dict):
                event_type = event.get("type")
                if event_type == "token":
                    token_text = event.get("content")
                    if isinstance(token_text, str):
                        capture.content_parts.append(token_text)
                elif event_type == "reasoning":
                    segments = event.get("segments")
                    if isinstance(segments, list):
                        capture.reasoning_segments = segments
            yield event

    def _tool_specs(
        self, tool_collections: list[ToolCollectionContext]
    ) -> tuple[list[dict[str, object]], dict[str, models.Collection]]:
        """Return tool schemas and collection mappings for chat completion requests."""
        if not tool_collections:
            return [], {}
        tools: list[dict[str, object]] = []
        tool_map: dict[str, models.Collection] = {}
        for tool_context in tool_collections:
            tool_name = tool_context.tool_name
            tool_map[tool_name] = tool_context.collection
            tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": (
                            "Search the Pinecone namespace for the collection "
                            f"'{tool_context.collection.name}' to gather grounded context. "
                            "Always call this tool before answering questions about "
                            "documents in this collection."
                        ),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "Natural language search query.",
                                },
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
            )
        return tools, tool_map

    @staticmethod
    def _select_tool_collection(
        *,
        tool_name: str,
        tool_map: dict[str, models.Collection],
    ) -> models.Collection:
        """Return the collection for a tool call name."""
        if tool_name in tool_map:
            return tool_map[tool_name]
        if tool_name == "pinecone_query" and len(tool_map) == 1:
            return next(iter(tool_map.values()))
        raise ValueError("Tool call does not match an enabled collection.")

    def stream_message(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> Generator[dict[str, Any], None, None]:
        """Stream a chat response while yielding intermediate events."""
        provider = self._ensure_provider(user)
        setup = self._prepare_chat_setup(
            user=user,
            payload=payload,
            provider=provider,
        )
        run_state = RunState(provider=provider.name)

        for _ in range(self.MAX_TOOL_ITERATIONS):
            capture = StreamCapture()
            try:
                stream_result = yield from self._stream_iteration(
                    provider=provider,
                    setup=setup,
                    capture=capture,
                )
            except GeneratorExit:
                self._record_partial_stream_exit(capture=capture, setup=setup)
                raise
            result = StreamIterationResult(
                message=stream_result[0],
                usage=stream_result[1],
                provider_name=stream_result[2],
                response_model_name=stream_result[4],
            )
            run_state.provider = result.provider_name or run_state.provider
            if result.usage:
                run_state.latest_usage_payload = result.usage
                self._update_usage_aggregate(run_state, result.usage)

            tool_calls_handled = yield from self._stream_tool_calls_if_needed(
                context=StreamToolCallContext(
                    message=result.message,
                    setup=setup,
                    run_state=run_state,
                    user=user,
                    payload=payload,
                )
            )
            if tool_calls_handled:
                continue

            response = self._finalize_response(
                setup=setup,
                run_state=run_state,
                response=ProviderResponse(
                    message=result.message,
                    usage=result.usage,
                    response_model_name=result.response_model_name,
                ),
            )
            yield {"type": "final", "payload": response.model_dump()}
            return

        raise RuntimeError("LLM did not complete within the allowed tool iteration limit.")

    def send_message(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> ChatCompletionResponse:
        """Send a chat message and return the final response."""
        provider = self._ensure_provider(user)
        setup = self._prepare_chat_setup(
            user=user,
            payload=payload,
            provider=provider,
        )
        run_state = RunState(provider=provider.name)

        max_iterations = 48
        iteration = 0
        while iteration < max_iterations:
            iteration += 1
            request = ChatRequest(
                messages=setup.messages,
                tools=setup.tools or None,
                model=setup.model.active_model_name,
                extra_body=build_openrouter_body(
                    setup.model.reasoning_options,
                    setup.model.provider_preferences,
                ),
                parameters=setup.model.parameter_overrides or None,
            )
            response_payload = provider.chat(request)
            parsed_response = provider.parse_chat_response(response_payload)
            run_state.provider = parsed_response.provider or run_state.provider
            if parsed_response.usage:
                run_state.latest_usage_payload = parsed_response.usage
                self._update_usage_aggregate(run_state, parsed_response.usage)

            resolution = self._resolve_tool_calls(
                message=parsed_response.message,
                run_state=run_state,
                combine_reasoning=False,
            )
            if resolution.pending_tool_calls:
                assistant_content = parsed_response.message.get("content")
                if isinstance(assistant_content, list):
                    assistant_content = json.dumps(assistant_content)
                self._append_tool_call_assistant_message(
                    session_model=setup.session_model,
                    messages=setup.messages,
                    assistant_content=assistant_content,
                    tool_calls=resolution.pending_tool_calls,
                )
                tool_context = ToolExecutionContext(
                    user=user,
                    payload=payload,
                    session_model=setup.session_model,
                    messages=setup.messages,
                    run_state=run_state,
                    shared_tool_reasoning=resolution.shared_tool_reasoning,
                    tool_collection_map=setup.tool_collection_map,
                )
                self._execute_tool_calls(
                    tool_calls=resolution.pending_tool_calls,
                    context=tool_context,
                )
                continue

            return self._finalize_response(
                setup=setup,
                run_state=run_state,
                response=ProviderResponse(
                    message=parsed_response.message,
                    usage=parsed_response.usage,
                    response_model_name=parsed_response.response_model,
                ),
            )

        raise RuntimeError("LLM did not complete within the allowed tool iteration limit.")
