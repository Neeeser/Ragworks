"""Model defaults for pipeline nodes and default pipeline builders read
runtime config (`get_app_config().models`), not the env-only `Settings`.

Every test that overrides a config field writes through `AppSettingRepository`
(the same path the admin PATCH route writes through) and invalidates
`get_app_config`'s process cache -- the autouse `_invalidate_cache` fixture
below resets the cache around every test in this module.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlmodel import Session

from app.db.repositories import AppSettingRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.nodes.embedding import EmbedderConfig
from app.pipelines.nodes.retrieval import ChatSettingsConfig
from app.services.app_config import invalidate_app_config_cache


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Ensure `get_app_config`'s process-wide cache never leaks across tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _set_override(session: Session, key: str, value: object) -> None:
    AppSettingRepository(session).upsert(key, value, updated_by=None)
    session.commit()
    invalidate_app_config_cache()


def test_embedder_config_default_reads_app_config(session: Session) -> None:
    _set_override(session, "models.default_embedding_model", "override/embedding-model")

    config = EmbedderConfig()

    assert config.model_name == "override/embedding-model"


def test_chat_settings_config_default_reads_app_config(session: Session) -> None:
    _set_override(session, "models.default_chat_model", "override/chat-model")

    config = ChatSettingsConfig()

    assert config.chat_model == "override/chat-model"


def test_build_default_ingestion_pipeline_uses_overridden_embedding_model(
    session: Session,
) -> None:
    _set_override(session, "models.default_embedding_model", "override/embedding-model")

    definition = build_default_ingestion_pipeline()

    embedder_node = next(node for node in definition.nodes if node.id == "embed-chunks")
    assert embedder_node.config["model_name"] == "override/embedding-model"


def test_build_default_retrieval_pipeline_uses_overridden_models(session: Session) -> None:
    _set_override(session, "models.default_embedding_model", "override/embedding-model")
    _set_override(session, "models.default_chat_model", "override/chat-model")

    definition = build_default_retrieval_pipeline()

    embedder_node = next(node for node in definition.nodes if node.id == "embed-query")
    chat_settings_node = next(node for node in definition.nodes if node.id == "chat-settings")
    assert embedder_node.config["model_name"] == "override/embedding-model"
    assert chat_settings_node.config["chat_model"] == "override/chat-model"
