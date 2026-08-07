"""Run a pipeline definition the editor has not saved.

The graph editor's inner loop is edit-test-edit, so testing a change must not
cost a version: this executes the draft definition the editor holds and hands
back the run's full trace. It runs the *same* machinery a tool invocation runs
(`PipelineRunner`, the trace recorder, the user's own provider connections) —
only the definition's source differs, and nothing about the run is persisted
beyond the trace itself.

A draft run deliberately records no `QueryEvent` and no telemetry: tuning a
pipeline would otherwise inflate the collection's own query counts and latency
charts with runs nobody made.
"""

from __future__ import annotations

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import PipelineRunRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.environment import VariableResolutionError
from app.pipelines.execution.runner import PipelineRunHandle, PipelineRunner
from app.pipelines.interface import derive_interface
from app.providers.registry import ProviderResolver
from app.schemas.pipelines import (
    PipelineDraftRunInvalidDetail,
    PipelineDraftRunRequest,
    PipelineDraftRunResponse,
    PipelineValidationIssueRead,
)
from app.schemas.traces import (
    PipelineNodeIORead,
    PipelineNodeRunRead,
    PipelineRunRead,
    PipelineTraceResponse,
)
from app.services.errors import InvalidInputError, InvalidQueryArgumentsError
from app.services.pipelines import PipelineService
from app.services.run_failures import build_run_failure
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider

DEFAULT_DRAFT_TOP_K = 5


class PipelineDraftInvalidError(InvalidInputError):
    """A draft was rejected before any run; `.detail` carries its issues.

    Subclasses `InvalidInputError` so the route's single `except ServiceError`
    maps it to 400 with the issue payload the editor already renders.
    """


class PipelineDraftRunService:
    """Execute an unsaved pipeline definition and return its trace."""

    def __init__(self, session: Session) -> None:
        """Initialize the service with a session."""
        self.session = session
        self._runs = PipelineRunRepository(session)

    def run(
        self,
        user: models.User,
        pipeline: models.Pipeline,
        collection: models.Collection,
        request: PipelineDraftRunRequest,
    ) -> PipelineDraftRunResponse:
        """Validate and run a draft definition against a collection.

        The draft is validated first, so a graph the server would refuse is
        reported as issues against the fields that cause them rather than as
        whatever a half-runnable graph fails with. A run that then fails is
        still returned as a trace: the node that failed is the answer the
        editor asked for.
        """
        self._require_runnable(user, request.definition)
        handle = self._start(user, pipeline, collection, request)
        try:
            PipelineRunner(self.session).execute(handle)
        except Exception as exc:
            handle.trace.mark_run_failed(exc)
            failure, _status = build_run_failure(handle, exc)
            return PipelineDraftRunResponse(trace=self._trace(handle), failure=failure)
        return PipelineDraftRunResponse(trace=self._trace(handle))

    def _require_runnable(self, user: models.User, definition: PipelineDefinition) -> None:
        """Reject a draft that fails validation, or that cannot serve a query.

        Validation runs first: a graph with real errors reports them against
        the fields that cause them, and "has no query input" would otherwise
        be the only thing said about a draft whose query path is merely
        unfinished.
        """
        result = PipelineService(self.session).validate_definition(user, definition)
        if not result.valid:
            raise PipelineDraftInvalidError(
                PipelineDraftRunInvalidDetail(
                    message="This draft cannot run until its errors are fixed.",
                    errors=result.errors,
                    issues=[
                        PipelineValidationIssueRead.model_validate(issue, from_attributes=True)
                        for issue in result.issues
                    ],
                ).model_dump(mode="json")
            )
        if derive_interface(definition).callable:
            return
        raise PipelineDraftInvalidError(
            PipelineDraftRunInvalidDetail(
                message=(
                    "This pipeline has no query input, so there is nothing to run a "
                    "sample query through. Only retrieval and tool pipelines can be "
                    "run from the editor."
                ),
            ).model_dump(mode="json")
        )

    def _start(
        self,
        user: models.User,
        pipeline: models.Pipeline,
        collection: models.Collection,
        request: PipelineDraftRunRequest,
    ) -> PipelineRunHandle:
        """Start the run, with no version because none was created."""
        try:
            return PipelineRunner(self.session).start(
                pipeline=pipeline,
                version=None,
                definition=request.definition,
                trigger=models.BindingRole.TOOL,
                user=user,
                collection=collection,
                settings=get_settings(),
                providers=ProviderResolver(user, self.session),
                vector_stores=VectorStoreProvider(user, self.session),
                storage=FileStorage(),
                query=request.query,
                top_k=request.top_k if request.top_k is not None else DEFAULT_DRAFT_TOP_K,
                arguments=request.arguments,
            )
        except VariableResolutionError as exc:
            raise InvalidQueryArgumentsError(str(exc)) from exc

    def _trace(self, handle: PipelineRunHandle) -> PipelineTraceResponse:
        """Build the run's trace against the definition the draft actually ran.

        Not `TraceService`: it resolves a version-less run's definition from
        the pipeline's *saved* version, which is precisely the graph a draft
        run did not execute. The resolved draft is on the handle.
        """
        self.session.flush()
        run = handle.run
        return PipelineTraceResponse(
            run=PipelineRunRead.model_validate(run),
            definition=handle.definition,
            node_runs=[
                PipelineNodeRunRead.model_validate(node_run)
                for node_run in self._runs.list_node_runs(run.id)
            ],
            node_io=[
                PipelineNodeIORead.model_validate(io_record)
                for io_record in self._runs.list_node_io(run.id)
            ],
        )
