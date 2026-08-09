"""A/B-ing two prompt versions: pinned pipeline copies, one run each."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.evals.comparison import compare_prompt_versions
from app.evals.service import EvalService
from app.schemas.enums import PromptContext
from app.schemas.evals import EvalRunConfig, PromptComparisonRequest
from app.schemas.prompts import PromptCreate, PromptVersionCreate
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipeline_scaffolds import DEFAULT_INGEST_SLUG, DEFAULT_SEARCH_SLUG
from app.services.pipelines import PipelineService
from app.services.prompts.library import PromptLibraryService
from tests.utils.providers import install_scaffolded_pipelines

CORPUS = '{"_id": "d1", "title": "T", "text": "alpha"}\n'
QUERIES = '{"_id": "q1", "text": "what is alpha"}\n'
QRELS = "q1\td1\t1\n"
NODE_ID = "expand-query"


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    user = models.User(email="compare@example.com", full_name="C", hashed_password="h")
    session.add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
    return user


def _prompt(session: Session, user: models.User) -> models.Prompt:
    """A two-version generate prompt to compare."""
    library = PromptLibraryService(session)
    prompt = library.create(
        user.id,
        PromptCreate(
            name="Query Expansion",
            context=PromptContext.NODE_GENERATE,
            body="Rewrite {{text}}",
            system_body="You rewrite queries.",
        ),
    )
    library.save_version(
        user.id,
        prompt.id,
        PromptVersionCreate(body="Rewrite {{text}} clinically.", system_body="You rewrite."),
    )
    session.commit()
    return prompt


def _pipeline_with_node(
    session: Session, user: models.User, prompt_id: object
) -> models.Pipeline:
    """A retrieval pipeline whose generate node references the prompt."""
    pipelines = PipelineService(session)
    source = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == DEFAULT_SEARCH_SLUG,
        )
    ).one()
    definition = pipelines.get_definition(source)
    raw = definition.model_dump(mode="json")
    raw["nodes"].append(
        {
            "id": NODE_ID,
            "type": "llm.generate",
            "name": "Query Expansion",
            "config": {
                "connection_id": str(uuid4()),
                "model_name": "stub-model",
                "prompt_ref": {"prompt_id": str(prompt_id), "version": "latest"},
                "output_fields": [
                    {
                        "name": "queries",
                        "type": "string_list",
                        "description": "Rewrites.",
                        "target": {"kind": "items"},
                    }
                ],
            },
            "position": None,
            "ui": {},
        }
    )
    # Wire it between the query input and the embedder so the graph the
    # comparison copies is one the validator accepts.
    raw["edges"] = [edge for edge in raw["edges"] if edge["id"] != "edge-retrieval-input"]
    raw["edges"].extend(
        [
            {
                "id": "edge-input-expand",
                "source": "query-input",
                "target": NODE_ID,
                "source_port": "items",
                "target_port": "items",
                "ui": {},
            },
            {
                "id": "edge-expand-embed",
                "source": NODE_ID,
                "target": "embed-query",
                "source_port": "items",
                "target_port": "items",
                "ui": {},
            },
        ]
    )
    version = pipelines.get_current_version(source)
    version.definition = raw
    session.add(version)
    session.commit()
    return source


def _request(**overrides: object) -> PromptComparisonRequest:
    base: dict[str, object] = {
        "version_a": 1,
        "version_b": 2,
        "config": EvalRunConfig(num_queries=1, distractor_pool_size=0),
    }
    base.update(overrides)
    return PromptComparisonRequest.model_validate(base)


def test_each_version_runs_against_a_pipeline_that_pins_it(
    session: Session, user: models.User
) -> None:
    prompt = _prompt(session, user)
    pipeline = _pipeline_with_node(session, user, prompt.id)
    service = EvalService(session)
    dataset = service.upload_dataset(user, name="G", corpus=CORPUS, queries=QUERIES, qrels=QRELS)
    ingestion = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == DEFAULT_INGEST_SLUG,
        )
    ).one()

    runs = compare_prompt_versions(
        session,
        user,
        _request(
            prompt_id=prompt.id,
            dataset_id=dataset.id,
            ingestion_pipeline_id=ingestion.id,
            retrieval_pipeline_id=pipeline.id,
        ),
        start_run=service.create_run,
    )
    session.commit()

    assert [run.name for run in runs] == ["Query Expansion v1", "Query Expansion v2"]
    # Each run names its own pipeline, and that pipeline's node pins the
    # version under test — the definition describes what the run did.
    pipelines = PipelineService(session)
    pinned_versions = []
    for run in runs:
        copy_row = pipelines.get_pipeline(run.retrieval_pipeline_id, user.id)
        assert copy_row is not None
        assert copy_row.id != pipeline.id
        node = next(
            node for node in pipelines.get_definition(copy_row).nodes if node.id == NODE_ID
        )
        pinned_versions.append(node.config["prompt_ref"]["version"])
    assert pinned_versions == [1, 2]


def test_comparing_a_version_that_does_not_exist_is_a_404(
    session: Session, user: models.User
) -> None:
    prompt = _prompt(session, user)
    pipeline = _pipeline_with_node(session, user, prompt.id)
    service = EvalService(session)
    dataset = service.upload_dataset(user, name="G", corpus=CORPUS, queries=QUERIES, qrels=QRELS)
    ingestion = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == DEFAULT_INGEST_SLUG,
        )
    ).one()

    with pytest.raises(NotFoundError, match="no version 7"):
        compare_prompt_versions(
            session,
            user,
            _request(
                prompt_id=prompt.id,
                version_b=7,
                dataset_id=dataset.id,
                ingestion_pipeline_id=ingestion.id,
                retrieval_pipeline_id=pipeline.id,
            ),
            start_run=service.create_run,
        )


def test_a_pipeline_that_never_uses_the_prompt_is_refused(
    session: Session, user: models.User
) -> None:
    # Pinning a version on a graph that does not reference the prompt would
    # produce two identical runs and a meaningless comparison.
    prompt = _prompt(session, user)
    service = EvalService(session)
    dataset = service.upload_dataset(user, name="G", corpus=CORPUS, queries=QUERIES, qrels=QRELS)
    retrieval = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == DEFAULT_SEARCH_SLUG,
        )
    ).one()
    ingestion = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == DEFAULT_INGEST_SLUG,
        )
    ).one()

    with pytest.raises(InvalidInputError, match="no node that uses"):
        compare_prompt_versions(
            session,
            user,
            _request(
                prompt_id=prompt.id,
                dataset_id=dataset.id,
                ingestion_pipeline_id=ingestion.id,
                retrieval_pipeline_id=retrieval.id,
            ),
            start_run=service.create_run,
        )


def test_comparing_a_version_with_itself_is_refused(
    session: Session, user: models.User
) -> None:
    prompt = _prompt(session, user)
    with pytest.raises(InvalidInputError, match="two different versions"):
        compare_prompt_versions(
            session,
            user,
            _request(
                prompt_id=prompt.id,
                version_a=1,
                version_b=1,
                dataset_id=uuid4(),
                ingestion_pipeline_id=uuid4(),
                retrieval_pipeline_id=uuid4(),
            ),
            start_run=EvalService(session).create_run,
        )
