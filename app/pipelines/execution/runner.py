"""Owns the pipeline run lifecycle: run row, trace recorder, and context.

Ingestion and retrieval both need the same four collaborators wired together
for every run: a `PipelineRun` row, a `PipelineTraceRecorder` bound to it, a
`PipelineExecutor`, and the `PipelineRunContext` nodes execute against.
`PipelineRunner` is the one place that creates them, so the two services
don't hand-roll the same bootstrap. Terminal run status is still owned by
`PipelineTraceRecorder` (the executor calls `mark_run_completed`/
`mark_run_failed` on it automatically); callers reach the same recorder
through `PipelineRunHandle.trace` for failures that happen outside of
`execute()` (e.g. persisting results after a successful run).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from sqlmodel import Session

from app.core.config import Settings
from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutionResult, PipelineExecutor
from app.pipelines.registry import NodeRegistry, default_registry
from app.pipelines.resolution import build_environment, resolve_definition
from app.pipelines.tracing import PipelineTraceRecorder
from app.providers.registry import ProviderResolver
from app.utils.file_storage import FileStorage
from app.utils.time import utc_now
from app.vectorstores.registry import VectorStoreProvider


@dataclass
class PipelineRunHandle:
    """A bootstrapped pipeline run: its row, trace recorder, and context.

    `definition` is the *resolved* definition (every `$expr` config value
    evaluated against this run's variable environment) — the one the run
    executes and the trace records, so traces show effective literals.
    """

    run: models.PipelineRun
    trace: PipelineTraceRecorder
    context: PipelineRunContext
    definition: PipelineDefinition


class PipelineRunner:
    """Bootstraps a pipeline run and executes a definition against it."""

    def __init__(self, session: Session, registry: NodeRegistry | None = None) -> None:
        """Initialize the runner with a session and node registry."""
        self._session = session
        self._executor = PipelineExecutor(registry or default_registry())

    def start(  # pylint: disable=too-many-arguments,too-many-locals
        self,
        *,
        pipeline: models.Pipeline,
        version: models.PipelineVersion,
        definition: PipelineDefinition,
        kind: models.PipelineKind,
        user: models.User,
        collection: models.Collection,
        settings: Settings,
        providers: ProviderResolver,
        vector_stores: VectorStoreProvider,
        storage: FileStorage,
        document: models.Document | None = None,
        query: str | None = None,
        top_k: int | None = None,
        arguments: Mapping[str, object] | None = None,
    ) -> PipelineRunHandle:
        """Create a pipeline run row, its trace recorder, and its context.

        Builds the run's variable environment (validating `arguments` against
        the definition's declarations) and resolves every `$expr` config
        value before the run row is created — invalid caller input raises
        `VariableResolutionError` and never records a failed run.
        """
        environment = build_environment(
            definition,
            query=query,
            supplied=arguments,
            legacy_top_k=top_k,
        )
        resolved = resolve_definition(definition, environment)
        run = models.PipelineRun(
            pipeline_id=pipeline.id,
            pipeline_version_id=version.id,
            pipeline_version=version.version,
            kind=kind,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.RUNNING,
            started_at=utc_now(),
        )
        self._session.add(run)
        self._session.flush()
        trace = PipelineTraceRecorder(self._session, run, resolved)
        context = PipelineRunContext(
            session=self._session,
            user=user,
            collection=collection,
            document=document,
            query=query,
            top_k=top_k,
            providers=providers,
            vector_stores=vector_stores,
            storage=storage,
            settings=settings,
            trace=trace,
            variables=environment,
        )
        return PipelineRunHandle(run=run, trace=trace, context=context, definition=resolved)

    def execute(self, handle: PipelineRunHandle) -> PipelineExecutionResult:
        """Run the handle's resolved definition against its context."""
        return self._executor.execute(handle.definition, handle.context)
