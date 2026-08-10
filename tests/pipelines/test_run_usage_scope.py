"""What a pipeline run's provider calls are attributed to in the ledger.

Regression: a non-ingest run with no caller-opened scope used to default its
surface to chat, so any future call site that forgot a scope silently booked
spend under the wrong surface — indistinguishable from real chat spend.
"""

from __future__ import annotations

from uuid import uuid4

from app.db import models
from app.pipelines.execution.runner import _run_usage_scope
from app.providers.usage_context import current_usage_scope, usage_scope
from app.schemas.enums import UsageSurface


def _run(trigger: models.BindingRole) -> models.PipelineRun:
    return models.PipelineRun(
        id=uuid4(),
        user_id=uuid4(),
        pipeline_id=uuid4(),
        pipeline_version=1,
        trigger=trigger.value,
        status=models.PipelineRunStatus.RUNNING,
    )


def test_an_ingest_run_names_its_own_surface() -> None:
    run = _run(models.BindingRole.INGEST)
    with _run_usage_scope(run):
        scope = current_usage_scope()
        assert scope is not None
        assert scope.surface is UsageSurface.INGESTION
        assert scope.context_id == run.id
    assert current_usage_scope() is None


def test_a_tool_run_without_a_caller_scope_records_nothing() -> None:
    with _run_usage_scope(_run(models.BindingRole.TOOL)):
        assert current_usage_scope() is None


def test_a_tool_run_inherits_the_surface_its_caller_opened() -> None:
    run = _run(models.BindingRole.TOOL)
    with usage_scope(run.user_id, UsageSurface.EVAL_RUN):
        with _run_usage_scope(run):
            scope = current_usage_scope()
            assert scope is not None
            assert scope.surface is UsageSurface.EVAL_RUN
