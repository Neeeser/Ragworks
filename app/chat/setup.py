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

from uuid import UUID

from sqlmodel import Session

from app.chat.messages import ProviderMessage, SystemMessage
from app.chat.model_settings import prepare_model_settings, resolve_chat_provider
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
from app.chat.state import (
    ChatSetup,
    PipelineContext,
    ToolCollectionContext,
)
from app.chat.tool_contexts import tool_contexts_for_collections
from app.chat.tools import ToolExecutor
from app.db import models
from app.db.repositories import (
    ChatRepository,
    CollectionRepository,
    ProviderConnectionRepository,
)
from app.providers.registry import resolve_connection
from app.schemas.chat import ChatMessageCreate
from app.schemas.enums import IndexBackend, ProviderType
from app.services.errors import InvalidInputError
from app.services.prompts import (
    PromptContext,
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
        contexts = tool_contexts_for_collections(self.session, user, ordered)
        # A Pinecone key is only required when one of the selected collections'
        # tools actually touches Pinecone (any index target, dense or BM25);
        # pgvector-backed collections need none.
        needs_pinecone = any(
            target.backend is IndexBackend.PINECONE
            for context in contexts
            for tool in context.tools
            for target in tool.settings.index_targets
        )
        if needs_pinecone and not ProviderConnectionRepository(
            self.session
        ).list_for_user_of_type(user.id, ProviderType.PINECONE.value):
            raise InvalidInputError(
                "No Pinecone connection is configured. Add one in Settings to enable tools."
            )
        return contexts, collection_ids

    def _resolve_session_model(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
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
        requested_connection = payload.provider_connection_id
        changed = False
        if requested_model and requested_model != session_model.chat_model:
            session_model.chat_model = requested_model
            changed = True
        if (
            requested_connection
            and requested_connection != session_model.provider_connection_id
        ):
            session_model.provider_connection_id = requested_connection
            changed = True
        if changed:
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
        messages.extend(
            provider_message_from_model(message)
            for message in history
            if message.role != models.ChatRole.ERROR
        )
        return messages

    # Orchestrates tool-collection resolution, model-settings resolution, and
    # prompt assembly for a turn; see the module docstring for the full sequence.
    # pylint: disable=too-many-locals
    def build(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> ChatSetup:
        """Resolve the full chat setup for a turn (see the module docstring)."""
        # Resolve a payload-supplied connection id BEFORE any session write:
        # a stale id would otherwise crash on the FK mid-flush (500), and a
        # foreign user's id would be persisted before the ownership check.
        if payload.provider_connection_id is not None:
            resolve_connection(self.session, user, payload.provider_connection_id)
        explicit_ids = payload.tool_collection_ids is not None
        primary_context: ToolCollectionContext | None = None
        tool_collections: list[ToolCollectionContext]
        tool_collection_ids: list[UUID]
        if explicit_ids:
            tool_collections, tool_collection_ids = self._resolve_tool_collections(
                user=user, payload=payload, session_model=None
            )
            primary_context = tool_collections[0] if tool_collections else None

        session_model, edit_target = self._resolve_session_model(
            user=user,
            payload=payload,
            primary_collection_id=primary_context.collection.id if primary_context else None,
        )

        if not explicit_ids:
            tool_collections, tool_collection_ids = self._resolve_tool_collections(
                user=user, payload=payload, session_model=session_model
            )
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
        provider, connection_label = resolve_chat_provider(
            self.session, user=user, session_model=session_model
        )
        messages = self._build_message_history(
            user=user, session_model=session_model, tool_collections=tool_collections
        )
        tools, tool_collection_map = ToolExecutor.specs(tool_collections)
        model_settings = prepare_model_settings(
            provider=provider,
            connection_label=connection_label,
            payload=payload,
            session_model=session_model,
            reasoning_effort=self.reasoning_effort,
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
            provider=provider,
        )
