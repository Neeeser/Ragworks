"""Chat service orchestration for sessions, tools, and streaming."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Generator, List, Optional, Tuple, cast
from uuid import uuid4

from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.api.config import get_settings
from app.db import models
from app.db.repositories import ChatRepository
from app.pipelines.config import resolve_ingestion_settings, resolve_retrieval_settings
from app.schemas.chat import ChatCompletionResponse, ChatMessageCreate, ToolCallTrace
from app.chat.processing.parameters import (
    build_openrouter_body,
    build_reasoning_options,
    prepare_reasoning_override,
    sanitize_parameter_overrides,
    sanitize_provider_preferences,
)
from app.chat.providers.base import ChatProvider, ChatRequest
from app.chat.providers.openrouter import OpenRouterProvider
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
from app.chat.processing.reasoning import normalize_reasoning_segments
from app.chat.state import (
    ChatSetup,
    ModelSettings,
    PipelineContext,
    ProviderResponse,
    RunState,
    StreamIterationResult,
    StreamToolCallContext,
    ToolCallResolution,
    ToolExecutionContext,
)
from app.chat.persistence.sessions import SessionRequest, apply_edit, ensure_session
from app.chat.streaming.streaming import stream_model_completion
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
from app.services.openrouter import OpenRouterClient, get_openrouter_client
from app.services.pipelines import PipelineService
from app.services.prompts import render_system_prompt
from app.services.retrieval import RetrievalService
from app.utils.time import utc_now


@dataclass
class StreamCapture:
    """Track partial stream state for abort handling."""

    content_parts: List[str] = field(default_factory=list)
    reasoning_segments: List[Dict[str, Any]] = field(default_factory=list)


class ChatService:
    """Manage chat sessions, tool calls, and provider interactions."""

    MAX_TOOL_ITERATIONS = 48

    def __init__(self, session: Session) -> None:
        """Initialize the chat service with database and provider clients."""
        self.session = session
        self.settings = get_settings()
        self.chat_repo = ChatRepository(session)
        self.openrouter: Optional[OpenRouterClient] = None
        self.provider: Optional[ChatProvider] = None
        self.retrieval = RetrievalService(session)
        effort_value = (self.settings.openrouter_reasoning_effort or "").strip()
        self.reasoning_effort: Optional[str] = effort_value or None

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

    def _resolve_session_model(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        payload: ChatMessageCreate,
        default_chat_model: str,
    ) -> Tuple[models.ChatSession, Optional[models.ChatMessage]]:
        """Resolve the chat session for the request payload."""
        if payload.edit_message_id:
            edit_target = self.chat_repo.get_message(payload.edit_message_id, user_id=user.id)
            if not edit_target:
                raise ValueError("Message not found for editing.")
            session_model = self.chat_repo.get_session(edit_target.session_id, user_id=user.id)
            if not session_model:
                raise ValueError("Chat session not found for edit.")
            if session_model.collection_id != collection.id:
                raise ValueError("Message belongs to a different collection.")
            return session_model, edit_target

        session_request = SessionRequest(
            chat_repo=self.chat_repo,
            session=self.session,
            user=user,
            collection=collection,
            payload=payload,
            default_chat_model=default_chat_model,
        )
        session_model = ensure_session(session_request)
        return session_model, None

    def _apply_payload_to_session(
        self,
        *,
        session_model: models.ChatSession,
        edit_target: Optional[models.ChatMessage],
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

    def _build_message_history(
        self,
        *,
        collection: models.Collection,
        user: models.User,
        session_model: models.ChatSession,
        pipeline: PipelineContext,
    ) -> List[Dict[str, Any]]:
        """Build the message history with the system prompt."""
        history = self.chat_repo.list_messages(session_model.id)
        system_prompt = render_system_prompt(
            collection,
            user,
            ingestion_settings=pipeline.ingestion_settings,
            retrieval_settings=pipeline.retrieval_settings,
        )
        messages = [{"role": "system", "content": system_prompt}]
        for msg in history:
            messages.append(serialize_message(msg))
        return messages

    def _build_reasoning_request_options(
        self,
        supported_parameters: List[str],
        reasoning_override: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Build reasoning options for the current model."""
        override_effort = reasoning_override.get("effort") if reasoning_override else None
        options = build_reasoning_options(
            supported_parameters,
            override_effort or self.reasoning_effort,
        )
        if reasoning_override and "reasoning" in options:
            options["reasoning"].update(reasoning_override)
        return options

    def _prepare_model_settings(
        self,
        *,
        provider: ChatProvider,
        payload: ChatMessageCreate,
        session_model: models.ChatSession,
        pipeline: PipelineContext,
    ) -> ModelSettings:
        """Resolve model settings, parameters, and preferences."""
        active_model_name = session_model.chat_model or pipeline.retrieval_settings.chat_model
        if not active_model_name:
            raise ValueError("This collection does not have a chat model configured.")
        model_info = provider.get_model(active_model_name)
        if not model_info:
            raise ValueError("Selected model is not available on OpenRouter.")
        supported_parameters = model_info.supported_parameters or []
        tool_supported = any(param.lower() == "tools" for param in supported_parameters)
        if not tool_supported:
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
        context_window = model_info.context_length or pipeline.retrieval_settings.context_window
        return ModelSettings(
            active_model_name=active_model_name,
            model_info=model_info,
            supported_parameters=supported_parameters,
            parameter_overrides=parameter_overrides,
            reasoning_options=reasoning_options,
            provider_preferences=provider_preferences,
            context_window=context_window,
        )

    def _prepare_chat_setup(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        payload: ChatMessageCreate,
        provider: ChatProvider,
    ) -> ChatSetup:
        """Prepare shared context needed for chat execution."""
        pipeline = self._resolve_pipeline_context(user, collection)
        session_model, edit_target = self._resolve_session_model(
            user=user,
            collection=collection,
            payload=payload,
            default_chat_model=pipeline.retrieval_settings.chat_model,
        )
        self._apply_payload_to_session(
            session_model=session_model,
            edit_target=edit_target,
            payload=payload,
        )
        self._maybe_update_session_model(session_model=session_model, payload=payload)
        messages = self._build_message_history(
            collection=collection,
            user=user,
            session_model=session_model,
            pipeline=pipeline,
        )
        tools = self._tool_spec(collection)
        model_settings = self._prepare_model_settings(
            provider=provider,
            payload=payload,
            session_model=session_model,
            pipeline=pipeline,
        )
        return ChatSetup(
            session_model=session_model,
            messages=messages,
            tools=tools,
            pipeline=pipeline,
            model=model_settings,
        )

    def _update_usage_aggregate(self, run_state: RunState, usage: Dict[str, Any]) -> None:
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
        message: Dict[str, Any],
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
        shared_tool_reasoning: Optional[Dict[str, Any]] = None
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
        tool_call: Dict[str, Any],
        payload: ChatMessageCreate,
        *,
        use_fallback_id: bool,
    ) -> Tuple[Optional[str], str, Dict[str, Any], str, int]:
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
        call_id: Optional[str],
        run_state: RunState,
        shared_tool_reasoning: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Select reasoning entry for tool call events."""
        return run_state.reasoning_call_segments.get(call_id) or shared_tool_reasoning

    def _build_reasoning_payload(
        self,
        *,
        call_id: Optional[str],
        run_state: RunState,
        shared_tool_reasoning: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
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
        messages: List[Dict[str, Any]],
        assistant_content: Optional[str],
        tool_calls: List[Dict[str, Any]],
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
    ) -> Generator[Dict[str, Any], None, bool]:
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
            collection=context.collection,
            payload=context.payload,
            session_model=context.setup.session_model,
            messages=context.setup.messages,
            run_state=context.run_state,
            shared_tool_reasoning=resolution.shared_tool_reasoning,
        )
        yield from self._stream_tool_calls(
            tool_calls=resolution.pending_tool_calls,
            context=tool_context,
        )
        return True

    def _execute_tool_calls(
        self,
        *,
        tool_calls: List[Dict[str, Any]],
        context: ToolExecutionContext,
    ) -> None:
        """Execute tool calls and persist the results."""
        for tool_call in tool_calls:
            call_id, name, arguments, query_text, top_k = self._parse_tool_call(
                tool_call,
                context.payload,
                use_fallback_id=False,
            )
            retrieval_response = self.retrieval.query_collection(
                context.user,
                context.collection,
                query_text,
                top_k=top_k,
            )
            response_payload = jsonable_encoder(retrieval_response)
            tool_payload = {
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
                    id=cast(str, call_id),
                    name=name,
                    arguments=arguments,
                    response=response_payload,
                    reasoning=reasoning_payload,
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

    def _stream_tool_calls(
        self,
        *,
        tool_calls: List[Dict[str, Any]],
        context: ToolExecutionContext,
    ) -> Generator[Dict[str, Any], None, None]:
        """Execute tool calls while emitting streaming events."""
        for tool_call in tool_calls:
            call_id, name, arguments, query_text, top_k = self._parse_tool_call(
                tool_call,
                context.payload,
                use_fallback_id=True,
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
            }
            retrieval_response = self.retrieval.query_collection(
                context.user,
                context.collection,
                query_text,
                top_k=top_k,
            )
            response_payload = jsonable_encoder(retrieval_response)
            tool_payload = {
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
                    id=cast(str, call_id),
                    name=name,
                    arguments=arguments,
                    response=response_payload,
                    reasoning=reasoning_payload,
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
        final_usage: Dict[str, Any] = dict(run_state.latest_usage_payload or response.usage or {})
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
        setup.session_model.updated_at = utc_now()
        self.session.add(setup.session_model)
        self.session.commit()
        return ChatCompletionResponse(
            session=convert_session(setup.session_model),
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
        Dict[str, Any],
        None,
        Tuple[Dict[str, Any], Dict[str, Any], str, Optional[str], Optional[str]],
    ]:
        """Run one streaming iteration and yield events."""
        request = ChatRequest(
            messages=setup.messages,
            tools=setup.tools,
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

    def _tool_spec(self, _collection: models.Collection) -> List[Dict[str, object]]:
        """Return tool schemas for chat completion requests."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "pinecone_query",
                    "description": (
                        "Search the Pinecone namespace for this collection to gather grounded "
                        "context. Always call this tool before answering user questions about "
                        "the documents."
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
        ]

    def stream_message(
        self,
        *,
        user: models.User,
        collection: models.Collection,
        payload: ChatMessageCreate,
    ) -> Generator[Dict[str, Any], None, None]:
        """Stream a chat response while yielding intermediate events."""
        provider = self._ensure_provider(user)
        setup = self._prepare_chat_setup(
            user=user,
            collection=collection,
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
                    collection=collection,
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
        collection: models.Collection,
        payload: ChatMessageCreate,
    ) -> ChatCompletionResponse:
        """Send a chat message and return the final response."""
        provider = self._ensure_provider(user)
        setup = self._prepare_chat_setup(
            user=user,
            collection=collection,
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
                tools=setup.tools,
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
                    collection=collection,
                    payload=payload,
                    session_model=setup.session_model,
                    messages=setup.messages,
                    run_state=run_state,
                    shared_tool_reasoning=resolution.shared_tool_reasoning,
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
