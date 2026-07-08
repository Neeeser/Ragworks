"""Request-setup pipeline for a chat turn.

`ChatSetupBuilder.build` resolves everything a chat turn needs before the
provider loop runs — session, tool collections + pipeline settings, typed
message history, model settings, persisted run preferences — and returns a
`ChatSetup`; the turn itself lives in `run_loop.py`/`tools.py`.

Tool collections are resolved exactly once: explicit payload ids resolve before
the session (that branch never reads the session), otherwise the session
resolves first and its stored collections drive resolution. The old seed/real
double resolution (full pipeline lookup twice per explicit request) is gone.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.chat.messages import ProviderMessage, SystemMessage
from app.chat.parameters import (
    build_reasoning_options,
    prepare_reasoning_override,
    sanitize_parameter_overrides,
)
from app.chat.persistence import (
    MessageRecord,
    RecordContext,
    SessionPreferencesUpdate,
    SessionRequest,
    apply_edit,
    ensure_session,
    persist_session_preferences,
    provider_message_from_model,
    record_message,
)
from app.chat.providers.base import ChatProvider
from app.chat.state import (
    ChatSetup,
    ModelSettings,
    PipelineContext,
    ToolCollectionContext,
)
from app.chat.tools import ToolExecutor
from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository
from app.schemas.chat import ChatMessageCreate
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.services.pipeline_resolution import (
    resolve_ingestion_pipeline,
    resolve_retrieval_pipeline,
)
from app.services.prompts import (
    PromptContext,
    collection_tool_name,
    get_system_prompt_template,
    render_system_prompt,
    system_prompt_context,
)


class ChatSetupBuilder:
    """Resolve the shared context a chat turn runs against."""

    def __init__(
        self,
        *,
        session: Session,
        chat_repo: ChatRepository,
        collection_repo: CollectionRepository,
        reasoning_effort: str | None,
    ) -> None:
        """Store the collaborators setup resolution reads and writes through."""
        self.session = session
        self.chat_repo = chat_repo
        self.collection_repo = collection_repo
        self.reasoning_effort = reasoning_effort

    def _resolve_pipeline_context(
        self, user: models.User, collection: models.Collection
    ) -> PipelineContext:
        """Resolve ingestion and retrieval pipeline settings for a collection.

        `PipelineResolutionError` subclasses `InvalidInputError`, so it flows
        through the same `except ServiceError` the routes use for every other
        chat domain error.
        """
        ingestion = resolve_ingestion_pipeline(self.session, user, collection)
        retrieval = resolve_retrieval_pipeline(self.session, user, collection)
        return PipelineContext(
            ingestion_settings=ingestion.settings,
            retrieval_settings=retrieval.settings,
        )

    def _build_tool_collection_context(
        self, user: models.User, collection: models.Collection
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

        collections = self.collection_repo.list_by_ids(user.id, collection_ids)
        collection_map = {collection.id: collection for collection in collections}
        missing = [
            str(collection_id)
            for collection_id in collection_ids
            if collection_id not in collection_map
        ]
        if missing:
            raise InvalidInputError("Selected collections are not available.")
        ordered = [collection_map[collection_id] for collection_id in collection_ids]
        contexts = [self._build_tool_collection_context(user, collection) for collection in ordered]
        # A Pinecone key is only required when one of the selected collections
        # actually retrieves from Pinecone; pgvector-backed collections need none.
        needs_pinecone = any(
            context.retrieval_settings.backend is IndexBackend.PINECONE for context in contexts
        )
        if needs_pinecone and not (user.pinecone_api_key or "").strip():
            raise InvalidInputError(
                "Pinecone API key is not configured. Update it in Settings to enable tools."
            )
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
                raise InvalidInputError("Message not found for editing.")
            session_model = self.chat_repo.get_session(edit_target.session_id, user_id=user.id)
            if not session_model:
                raise InvalidInputError("Chat session not found for edit.")
            return session_model, edit_target

        session_request = SessionRequest(
            chat_repo=self.chat_repo,
            session=self.session,
            user=user,
            payload=payload,
            default_chat_model=default_chat_model,
            primary_collection_id=primary_collection_id,
        )
        return ensure_session(session_request), None

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
            raise InvalidInputError("Message content cannot be empty.")
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
        user: models.User,
        session_model: models.ChatSession,
        tool_collections: list[ToolCollectionContext],
    ) -> list[ProviderMessage]:
        """Build the typed message history, prefixed with the system prompt."""
        history = self.chat_repo.list_messages(session_model.id)
        tool_contexts: list[PromptContext] = []
        for tool_context in tool_collections:
            template = get_system_prompt_template(tool_context.collection)
            context = system_prompt_context(
                tool_context.collection,
                user,
                ingestion_settings=tool_context.ingestion_settings,
                retrieval_settings=tool_context.retrieval_settings,
                tool_name=tool_context.tool_name,
            )
            tool_contexts.append(PromptContext(template=template, context=context))
        system_prompt = render_system_prompt(tool_contexts, user)
        messages: list[ProviderMessage] = [SystemMessage(content=system_prompt)]
        messages.extend(provider_message_from_model(msg) for msg in history)
        return messages

    def _build_reasoning_request_options(
        self, supported_parameters: list[str], reasoning_override: dict[str, Any] | None
    ) -> dict[str, Any]:
        """Build reasoning options for the current model."""
        override_effort = reasoning_override.get("effort") if reasoning_override else None
        options = build_reasoning_options(supported_parameters, override_effort or self.reasoning_effort)
        if reasoning_override and "reasoning" in options:
            options["reasoning"].update(reasoning_override)
        return options

    # Resolves model info, tool support, parameter overrides, reasoning options,
    # provider preferences, and context window in one pass; splitting further
    # would just relocate these locals into an intermediate object.
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
            raise InvalidInputError("No chat model is configured for this session.")
        model_info = provider.get_model(active_model_name)
        if not model_info:
            raise InvalidInputError("Selected model is not available on OpenRouter.")
        supported_parameters = model_info.supported_parameters or []
        tool_supported = any(param.lower() == "tools" for param in supported_parameters)
        if tools_enabled and not tool_supported:
            raise InvalidInputError("Selected model does not support tool calls required for retrieval.")
        parameter_overrides = sanitize_parameter_overrides(payload.parameters, supported_parameters)
        reasoning_override = prepare_reasoning_override(parameter_overrides.pop("reasoning", None))
        reasoning_options = self._build_reasoning_request_options(
            supported_parameters, reasoning_override
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

    # Orchestrates tool-collection resolution, model-settings resolution, and
    # prompt assembly for a turn; see the module docstring for the full sequence.
    # pylint: disable=too-many-locals
    def build(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
        provider: ChatProvider,
    ) -> ChatSetup:
        """Resolve the full chat setup for a turn (see the module docstring)."""
        explicit_ids = payload.tool_collection_ids is not None
        primary_context: ToolCollectionContext | None = None
        tool_collections: list[ToolCollectionContext]
        tool_collection_ids: list[UUID]
        if explicit_ids:
            tool_collections, tool_collection_ids = self._resolve_tool_collections(
                user=user, payload=payload, session_model=None
            )
            primary_context = tool_collections[0] if tool_collections else None
            default_chat_model = (
                primary_context.retrieval_settings.chat_model
                if primary_context and primary_context.retrieval_settings.chat_model
                else get_app_config().models.default_chat_model
            )
            fallback_context_window = (
                primary_context.retrieval_settings.context_window if primary_context else 0
            )
        else:
            default_chat_model = get_app_config().models.default_chat_model
            fallback_context_window = 0

        session_model, edit_target = self._resolve_session_model(
            user=user,
            payload=payload,
            default_chat_model=default_chat_model,
            primary_collection_id=primary_context.collection.id if primary_context else None,
        )

        if not explicit_ids:
            tool_collections, tool_collection_ids = self._resolve_tool_collections(
                user=user, payload=payload, session_model=session_model
            )
            if tool_collections:
                fallback_context_window = tool_collections[0].retrieval_settings.context_window
        else:
            self.chat_repo.replace_session_collections(
                session_id=session_model.id, collection_ids=tool_collection_ids
            )
            session_model.collection_id = tool_collection_ids[0] if tool_collection_ids else None
            self.session.add(session_model)
            self.session.flush()

        self._apply_payload_to_session(
            session_model=session_model, edit_target=edit_target, payload=payload
        )
        self._maybe_update_session_model(session_model=session_model, payload=payload)
        messages = self._build_message_history(
            user=user, session_model=session_model, tool_collections=tool_collections
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
        persist_session_preferences(
            session=self.session,
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
            pipeline=(
                PipelineContext(
                    ingestion_settings=primary_context.ingestion_settings,
                    retrieval_settings=primary_context.retrieval_settings,
                )
                if primary_context
                else None
            ),
            model=model_settings,
        )
