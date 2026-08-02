"""The startup prompt migration: entity-fication of every consumer."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import PromptRepository, UserRepository
from app.pipelines.llm.presets import TRANSFORM_PRESETS
from app.schemas.enums import PromptSource
from app.services.prompt_migration import (
    migrate_prompt_entities,
    rewrite_legacy_grammar,
)
from app.services.prompts.seeding import BASE_PROMPT_KEY
from app.services.prompts.usage import NODE_PROMPT_REF_KEY, TOOL_PROMPT_REF_KEY


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    user = models.User(
        email="legacy@example.com",
        full_name="Legacy",
        hashed_password="h",
        system_prompt_template="My custom base with {{user.email}}",
    )
    UserRepository(session).add(user)
    session.commit()
    return user


def _summarize_preset_config() -> dict[str, object]:
    preset = next(p for p in TRANSFORM_PRESETS if p.id == "summarize")
    return dict(preset.config)


def _legacy_pipeline(session: Session, user: models.User) -> models.Pipeline:
    pipeline = models.Pipeline(user_id=user.id, name="My ingest", current_version=1)
    session.add(pipeline)
    session.flush()
    # Legacy single-brace grammar, one preset-matching node (after grammar
    # rewrite) and one custom node.
    preset_config = _summarize_preset_config()
    preset_config["prompt"] = "Summarize this text in a few sentences:\n\n{text}"
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition={
                "nodes": [
                    {"id": "parse", "type": "parser.text", "config": {}},
                    {"id": "sum", "type": "llm.transform", "config": preset_config},
                    {
                        "id": "custom",
                        "type": "llm.transform",
                        "config": {
                            "system_prompt": "",
                            "prompt": "Do my thing to {text} with {{literal}}",
                            "output_fields": [],
                        },
                    },
                ],
                "edges": [],
            },
        )
    )
    session.commit()
    return pipeline


def _node_configs(session: Session, pipeline: models.Pipeline) -> dict[str, dict[str, object]]:
    from sqlmodel import select

    row = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline.id
        )
    ).one()
    return {node["id"]: node.get("config", {}) for node in row.definition["nodes"]}


def test_rewrite_legacy_grammar() -> None:
    assert rewrite_legacy_grammar("A {text} and {metadata.author}") == (
        "A {{text}} and {{metadata.author}}"
    )
    # Legacy escapes become the literal braces they meant.
    assert rewrite_legacy_grammar("JSON {{\"a\": 1}} uses {text}") == 'JSON {"a": 1} uses {{text}}'
    # Already-migrated text is untouched (no single-brace placeholders left).
    migrated = 'Use {{text}} and JSON {"a": {"b": 1}}'
    assert rewrite_legacy_grammar(migrated) == migrated


def test_migration_entity_fies_every_consumer(session: Session, user: models.User) -> None:
    collection = models.Collection(
        user_id=user.id,
        name="Docs",
        extra_metadata={"system_prompt_template": "Custom tool prompt {{collection.name}}"},
    )
    session.add(collection)
    pipeline = _legacy_pipeline(session, user)

    migrate_prompt_entities(session)

    session.refresh(user)
    session.refresh(collection)
    prompts = PromptRepository(session)

    # Custom base prompt became an owned entity, referenced by the user.
    assert user.base_prompt_id is not None
    base = prompts.get(user.base_prompt_id)
    assert base is not None
    assert base.source == PromptSource.USER
    assert user.system_prompt_template is None

    # Collection legacy template became an entity, key rewritten to a ref.
    metadata = collection.extra_metadata or {}
    assert "system_prompt_template" not in metadata
    assert TOOL_PROMPT_REF_KEY in metadata

    # The preset-matching node collapsed onto the shipped preset prompt;
    # the custom node got its own entity; grammar rewritten everywhere.
    configs = _node_configs(session, pipeline)
    sum_ref = configs["sum"][NODE_PROMPT_REF_KEY]
    assert isinstance(sum_ref, dict)
    shipped = prompts.get_by_shipped_key(user.id, "preset.summarize")
    assert shipped is not None
    assert sum_ref["prompt_id"] == str(shipped.id)
    custom_ref = configs["custom"][NODE_PROMPT_REF_KEY]
    assert isinstance(custom_ref, dict)
    custom_prompt = prompts.get(UUID(str(custom_ref["prompt_id"])))
    assert custom_prompt is not None
    assert custom_prompt.name == "My ingest — custom"
    assert configs["custom"]["prompt"] == ""

    # Shipped defaults seeded for the user.
    assert prompts.get_by_shipped_key(user.id, BASE_PROMPT_KEY) is not None


def test_migration_is_idempotent(session: Session, user: models.User) -> None:
    pipeline = _legacy_pipeline(session, user)
    migrate_prompt_entities(session)
    first = _node_configs(session, pipeline)
    first_count = len(PromptRepository(session).list_for_user(user.id))

    migrate_prompt_entities(session)
    second = _node_configs(session, pipeline)
    second_count = len(PromptRepository(session).list_for_user(user.id))

    assert first == second
    assert first_count == second_count


def test_seeding_backfills_output_fields_without_a_new_version(
    session: Session, user: models.User
) -> None:
    """A text-identical seeded version gains its schema in place, staying v1.

    Rows seeded before versions carried `output_fields` would otherwise see
    every preset prompt append a body-identical "Shipped update" v2 on the
    next boot — exactly the version noise seeding exists to avoid.
    """
    from app.db.repositories import PromptVersionRepository
    from app.services.prompts.seeding import seed_shipped_prompts

    seeded = seed_shipped_prompts(session, user.id)
    session.commit()
    extractor = seeded["preset.metadata-extractor"]
    versions_repo = PromptVersionRepository(session)
    v1 = versions_repo.get_by_version(extractor.id, 1)
    assert v1 is not None and v1.output_fields is not None
    # Simulate a row seeded before versions carried a schema.
    v1.output_fields = None
    session.add(v1)
    session.commit()

    reseeded = seed_shipped_prompts(session, user.id)
    session.commit()
    assert reseeded["preset.metadata-extractor"].current_version == 1
    refreshed = versions_repo.get_by_version(extractor.id, 1)
    assert refreshed is not None and refreshed.output_fields is not None
