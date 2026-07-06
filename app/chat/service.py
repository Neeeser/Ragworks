"""Chat service orchestration for sessions, tools, and streaming.

Request setup (session/collection/model resolution, message history, preference
persistence) lives here; the actual chat turn — the provider loop, tool
execution, and finalization — lives in `run_loop.py`/`tools.py`. `send_message`
and `stream_message` are thin entry points that build a `ChatRun` and hand it to
the single `run_chat` implementation (streaming is a parameter, not a fork).
"""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.chat.persistence.records import (
    MessageRecord,
    RecordContext,
    record_message,
    serialize_message,
)
from app.chat.persistence.sessions import SessionRequest, apply_edit, ensure_session
from app.chat.processing.parameters import (
    build_reasoning_options,
    prepare_reasoning_override,
    sanitize_parameter_overrides,
)
from app.chat.providers.base import ChatProvider
from app.chat.providers.openrouter import OpenRouterProvider
from app.chat.run_loop import ChatRun, run_chat
from app.chat.state import (
    ChatSetup,
    ModelSettings,
    PipelineContext,
    RunState,
    ToolCollectionContext,
)
from app.chat.tools import ToolExecutor
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


@dataclass(frozen=True)
class SessionPreferencesUpdate:
    """Normalized run settings persisted for sessions and users."""

    parameter_overrides: dict[str, Any] | None
    provider_preferences: dict[str, Any] | None
    stream_enabled: bool
    tool_collection_ids: list[UUID]


class ChatService:
    """Manage chat sessions, tool calls, and provider interactions."""

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
        provider_preferences = payload.provider.to_request_payload() if payload.provider else None
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
        tools, tool_collection_map = ToolExecutor.specs(tool_collections)
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

    def _build_run(self, *, user: models.User, payload: ChatMessageCreate) -> ChatRun:
        """Resolve providers and setup, then assemble the run context for a turn."""
        provider = self._ensure_provider(user)
        setup = self._prepare_chat_setup(user=user, payload=payload, provider=provider)
        return ChatRun(
            provider=provider,
            setup=setup,
            run_state=RunState(provider=provider.name),
            user=user,
            payload=payload,
            session=self.session,
            chat_repo=self.chat_repo,
            tool_executor=ToolExecutor(
                session=self.session,
                chat_repo=self.chat_repo,
                retrieval=self.retrieval,
            ),
        )

    def send_message(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> ChatCompletionResponse:
        """Send a chat message and return the final response."""
        return run_chat(self._build_run(user=user, payload=payload), stream=False)

    def stream_message(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> Generator[dict[str, Any], None, None]:
        """Stream a chat response while yielding intermediate events."""
        return run_chat(self._build_run(user=user, payload=payload), stream=True)
