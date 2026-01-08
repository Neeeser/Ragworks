from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.chat.service import ChatService, SessionPreferencesUpdate
from app.chat.state import ModelSettings
from app.db import models
from app.schemas.models import ModelInfo


def test_persist_session_preferences_updates_session_and_user(session: Session) -> None:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    chat_session = models.ChatSession(
        user_id=user.id,
        title="Session",
        mode=models.ChatMode.CHAT,
        chat_model="test-model",
        context_tokens=0,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)

    service = ChatService(session)
    model_info = ModelInfo(id="test-model", name="Test Model", supported_parameters=[])
    model_settings = ModelSettings(
        active_model_name="test-model",
        model_info=model_info,
        supported_parameters=[],
        parameter_overrides={"temperature": 0.2},
        reasoning_options={},
        provider_preferences={"order": ["alpha"]},
        context_window=8192,
    )
    tool_id = uuid4()
    service._persist_session_preferences(
        session_model=chat_session,
        user=user,
        preferences=SessionPreferencesUpdate(
            parameter_overrides=model_settings.parameter_overrides,
            provider_preferences=model_settings.provider_preferences,
            stream_enabled=True,
            tool_collection_ids=[tool_id],
        ),
    )

    session.refresh(chat_session)
    session.refresh(user)

    assert chat_session.parameter_overrides == {"temperature": 0.2}
    assert chat_session.provider_preferences == {"order": ["alpha"]}
    assert chat_session.stream is True
    assert user.last_used_chat_model == "test-model"
    assert user.last_used_parameters == {"temperature": 0.2}
    assert user.last_used_provider == {"order": ["alpha"]}
    assert user.last_used_stream is True
    assert user.last_used_tool_collection_ids == [str(tool_id)]
