"""Shape a failed pipeline run into the trace-linked detail clients render.

Every surface that runs a retrieval graph — the tool invocation path and the
editor's draft run — reports a failure the same way: name the node that
failed, classify the cause, and link the run trace. The two must say the same
thing about the same failure, so the shaping lives here rather than once per
caller.
"""

from __future__ import annotations

from app.pipelines.execution.runner import PipelineRunHandle
from app.schemas.provider_errors import ProviderErrorDetail
from app.schemas.retrieval import FailedNodeRef, RetrievalFailureDetail
from app.services.errors import InvalidInputError, provider_error_status
from app.services.provider_errors import classify_provider_error


def build_run_failure(
    handle: PipelineRunHandle, exc: Exception
) -> tuple[RetrievalFailureDetail, int]:
    """Return the structured detail for a failed run and its HTTP status.

    Reads the FAILED node from the in-memory trace recorder -- never a DB
    query, because a mid-run DB error (e.g. a vector-dimension mismatch)
    aborts the transaction and any post-failure SELECT would raise.
    """
    failed_node_run = handle.trace.failed_node_run
    failed_node = (
        FailedNodeRef(
            node_id=failed_node_run.node_id,
            node_name=failed_node_run.node_name,
            node_type=failed_node_run.node_type,
        )
        if failed_node_run
        else None
    )
    where = f" at {failed_node.node_name}" if failed_node else ""
    message, status_code, provider_detail = _classify(exc, where)
    detail = RetrievalFailureDetail(
        message=message,
        code="retrieval_pipeline_failed",
        failed_node=failed_node,
        pipeline_run_id=handle.run.id,
        provider_error=provider_detail,
    )
    return detail, status_code


def _classify(exc: Exception, where: str) -> tuple[str, int, ProviderErrorDetail | None]:
    """Return the user-facing message, status, and provider detail for a run.

    A provider fault is classified rather than summarized as "the provider
    returned an error": an exhausted credit balance and an overloaded
    endpoint both fail every query, and only one of them is fixed by
    waiting, so the message has to say which. The provider's raw sentence
    still stays out of the primary message -- the response links the run
    trace, which is where it belongs -- and rides along on the detail.

    The 400 branch matters because a node's `InvalidInputError` already says
    exactly what to change (a namespace the account does not own, an
    embedding dimension the index disagrees with, a sparse index on a server
    without pg_search). Folding those into "internal error" hides the one
    sentence that would fix the pipeline.
    """
    if isinstance(exc, InvalidInputError):
        return f"Retrieval failed{where}: {exc.detail}", 400, None
    provider_detail = classify_provider_error(exc)
    if provider_detail is not None:
        return (
            f"Retrieval failed{where}. {provider_detail.message}",
            provider_error_status(provider_detail.code),
            provider_detail,
        )
    return (
        f"Retrieval failed{where} due to an internal error. See the run trace for details."
    ), 500, None
