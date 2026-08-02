"""Prompt library behavior: versions, forks, resolution, delete guard."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.schemas.enums import PromptContext, PromptSource
from app.schemas.prompts import (
    PromptCreate,
    PromptForkCreate,
    PromptVersionCreate,
)
from app.services.errors import InvalidInputError, NotFoundError
from app.services.prompts.library import PromptLibraryService
from app.services.prompts.usage import TOOL_PROMPT_REF_KEY, prompt_usages


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    user = models.User(email="p@example.com", full_name="P", hashed_password="h")
    UserRepository(session).add(user)
    session.commit()
    return user


def _create(
    service: PromptLibraryService,
    user: models.User,
    *,
    body: str = "Hello {{user.full_name}}",
    context: PromptContext = PromptContext.CHAT_BASE,
    name: str = "Greeting",
) -> models.Prompt:
    return service.create(
        user.id,
        PromptCreate(name=name, context=context, body=body),
    )


def test_create_seeds_version_one(session: Session, user: models.User) -> None:
    service = PromptLibraryService(session)
    prompt = _create(service, user)
    assert prompt.current_version == 1
    resolved = service.resolve(user.id, prompt.id, "latest")
    assert resolved.version.body == "Hello {{user.full_name}}"


def test_create_rejects_unknown_variables(session: Session, user: models.User) -> None:
    service = PromptLibraryService(session)
    with pytest.raises(InvalidInputError, match="chunk_txt"):
        _create(service, user, body="{{chunk_txt}}")


def test_save_version_bumps_current_and_latest_follows(
    session: Session, user: models.User
) -> None:
    service = PromptLibraryService(session)
    prompt = _create(service, user)
    service.save_version(
        user.id, prompt.id, PromptVersionCreate(body="v2 body", label="tightened")
    )
    assert prompt.current_version == 2
    assert service.resolve(user.id, prompt.id, "latest").version.body == "v2 body"
    assert service.resolve(user.id, prompt.id, 1).version.body == "Hello {{user.full_name}}"


def test_fork_copies_one_version_into_new_entity(session: Session, user: models.User) -> None:
    service = PromptLibraryService(session)
    prompt = _create(service, user)
    service.save_version(user.id, prompt.id, PromptVersionCreate(body="v2 body"))
    fork = service.fork(
        user.id, prompt.id, PromptForkCreate(name="Greeting fork", version=1)
    )
    assert fork.id != prompt.id
    assert fork.source == PromptSource.USER
    assert fork.current_version == 1
    assert service.resolve(user.id, fork.id, "latest").version.body == "Hello {{user.full_name}}"


def test_fork_across_contexts_revalidates(session: Session, user: models.User) -> None:
    service = PromptLibraryService(session)
    prompt = _create(
        service,
        user,
        body="Summarize: {{text}}",
        context=PromptContext.NODE_TRANSFORM,
        name="Summarize",
    )
    with pytest.raises(InvalidInputError, match="text"):
        service.fork(
            user.id,
            prompt.id,
            PromptForkCreate(name="As chat", context=PromptContext.CHAT_BASE),
        )


def test_delete_refuses_while_referenced(session: Session, user: models.User) -> None:
    service = PromptLibraryService(session)
    prompt = _create(service, user)
    user.base_prompt_id = prompt.id
    session.add(user)
    session.commit()
    with pytest.raises(InvalidInputError, match="referenced"):
        service.delete(user.id, prompt.id)
    user.base_prompt_id = None
    session.add(user)
    session.commit()
    service.delete(user.id, prompt.id)
    with pytest.raises(NotFoundError):
        service.get(user.id, prompt.id)


def test_usage_scan_covers_collections_and_pipelines(
    session: Session, user: models.User
) -> None:
    service = PromptLibraryService(session)
    prompt = _create(
        service,
        user,
        body="Use {{collection.name}}",
        context=PromptContext.CHAT_TOOL,
        name="Tool prompt",
    )
    collection = models.Collection(
        user_id=user.id,
        name="Docs",
        extra_metadata={
            TOOL_PROMPT_REF_KEY: {"prompt_id": str(prompt.id), "version": 2}
        },
    )
    session.add(collection)
    pipeline = models.Pipeline(user_id=user.id, name="Ingest", current_version=1)
    session.add(pipeline)
    session.flush()
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition={
                "nodes": [
                    {
                        "id": "llm-1",
                        "type": "llm.transform",
                        "config": {
                            "prompt_ref": {"prompt_id": str(prompt.id), "version": "latest"}
                        },
                    }
                ],
                "edges": [],
            },
        )
    )
    session.commit()
    usages = prompt_usages(session, user.id, prompt.id)
    kinds = {usage.kind for usage in usages}
    assert kinds == {"collection_tool", "pipeline_node"}
    versions = {usage.kind: usage.version for usage in usages}
    assert versions["collection_tool"] == 2
    assert versions["pipeline_node"] == "latest"


def test_cross_user_prompt_is_not_found(session: Session, user: models.User) -> None:
    service = PromptLibraryService(session)
    prompt = _create(service, user)
    with pytest.raises(NotFoundError):
        service.get(uuid4(), prompt.id)
