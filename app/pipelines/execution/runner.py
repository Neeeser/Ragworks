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
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass

from sqlmodel import Session

from app.core.config import Settings
from app.db import models
from app.observability import events as log_events
from app.observability import get_logger
from app.pipelines.definition import PipelineDefinition
from app.pipelines.environment import build_environment
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutionResult, PipelineExecutor
from app.pipelines.payloads import MediaAsset
from app.pipelines.prompt_refs import resolve_prompt_references
from app.pipelines.registry import NodeRegistry, default_registry
from app.pipelines.resolution import resolve_definition
from app.pipelines.settings import collection_scope
from app.pipelines.tracing import PipelineTraceRecorder
from app.pipelines.variables import BindingContext
from app.providers.registry import ProviderResolver
from app.providers.usage_context import current_usage_scope, usage_scope
from app.schemas.enums import UsageSurface
from app.utils.file_storage import FileStorage
from app.utils.time import utc_now
from app.vectorstores.registry import VectorStoreProvider

logger = get_logger(__name__)


def _run_usage_scope(run: models.PipelineRun) -> AbstractContextManager[object]:
    """Attribute a run's provider calls, or leave them unattributed.

    An ingest-triggered run is ingestion however it was started, so it names
    its own surface. Every other trigger is a tool invocation whose surface
    belongs to whoever asked for it — a chat turn, an eval, the studio — and
    the runner cannot tell which: with no scope already open, the calls are
    left out of the ledger rather than booked to a guessed surface, because
    spend filed under the wrong surface is worse than spend nobody counted.
    """
    inherits = current_usage_scope() is not None
    if not inherits and run.trigger != models.BindingRole.INGEST:
        return nullcontext()
    # The surface is only read when nothing is open, which is the ingest case.
    return usage_scope(
        run.user_id,
        UsageSurface.INGESTION,
        context_type="pipeline_run",
        context_id=run.id,
    )


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

    # The run context wires every port dependency explicitly by design.
    def start(  # noqa: PLR0913
        self,
        *,
        pipeline: models.Pipeline,
        version: models.PipelineVersion | None,
        definition: PipelineDefinition,
        trigger: models.BindingRole,
        user: models.User,
        collection: models.Collection,
        settings: Settings,
        providers: ProviderResolver,
        vector_stores: VectorStoreProvider,
        storage: FileStorage,
        document: models.Document | None = None,
        query: str | None = None,
        query_media: MediaAsset | None = None,
        top_k: int | None = None,
        arguments: Mapping[str, object] | None = None,
        draft: bool = False,
    ) -> PipelineRunHandle:
        """Create a pipeline run row, its trace recorder, and its context.

        Builds the run's variable environment (validating `arguments` against
        the definition's declarations) and resolves every `$expr` config
        value before the run row is created — invalid caller input raises
        `VariableResolutionError` and never records a failed run.

        The collection supplies only its descriptors (`collection_id` and
        friends): a binding says which collection is running, never what the
        pipeline does, so the run reads exactly the index the settings
        resolver and the purge cascade resolved from the definition.

        `version` is `None` for a run of a definition no version holds — the
        editor's draft run. The run row then records which pipeline was being
        edited and nothing about a version, because none was created, and
        `draft` marks it so run listings and stats can leave it out: an
        editor experiment is not something the collection's owner ran.
        """
        environment = build_environment(
            definition,
            query=query,
            supplied=arguments,
            request_top_k=top_k,
            binding=BindingContext(collection=collection_scope(collection)),
        )
        resolved = resolve_definition(definition, environment)
        # Prompt references resolve after expressions, before the run row
        # exists — a dangling reference raises and never records a failed
        # run. Provenance pins `latest` to the concrete version it ran as.
        resolved, prompt_provenance = resolve_prompt_references(
            self._session, user.id, resolved
        )
        # The caller-facing result limit becomes the run's effective request
        # depth at this boundary. Retriever configs still use their precise
        # `top_k` field name and may deliberately over-fetch.
        result_limit = environment.values.get("result_limit")
        if isinstance(result_limit, int) and not isinstance(result_limit, bool):
            top_k = result_limit
        run = models.PipelineRun(
            pipeline_id=pipeline.id,
            pipeline_version_id=version.id if version else None,
            pipeline_version=version.version if version else None,
            is_draft=draft,
            trigger=trigger,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.RUNNING,
            started_at=utc_now(),
            prompt_versions=prompt_provenance or None,
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
            query_media=query_media,
        )
        logger.info(
            log_events.PIPELINE_RUN_STARTED,
            pipeline_run_id=str(run.id),
            collection_id=str(collection.id),
            trigger=trigger.value,
        )
        return PipelineRunHandle(run=run, trace=trace, context=context, definition=resolved)

    def execute(self, handle: PipelineRunHandle) -> PipelineExecutionResult:
        """Run the handle's resolved definition against its context.

        Terminal run *status* stays owned by the trace recorder; this only
        emits the observability event for the run's outcome.

        Every provider call the run makes is attributed to this run in the
        usage ledger. The surface is the caller's when one is already open —
        a retrieval run belongs to the chat turn or eval that asked for it —
        and falls back to what the trigger says the run itself is.
        """
        try:
            with _run_usage_scope(handle.run):
                result = self._executor.execute(handle.definition, handle.context)
        except Exception as exc:
            logger.error(
                log_events.PIPELINE_RUN_FAILED,
                pipeline_run_id=str(handle.run.id),
                error_type=exc.__class__.__name__,
                exc_info=True,
            )
            raise
        logger.info(
            log_events.PIPELINE_RUN_COMPLETED,
            pipeline_run_id=str(handle.run.id),
        )
        return result
