"""Provider-aware validation helpers for pipeline definitions."""

from __future__ import annotations

import logging
from collections.abc import Callable
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.prompt_refs import PromptRefError, resolve_prompt_references
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidationResult, PipelineValidator
from app.providers.registry import get_provider, resolve_connection
from app.schemas.enums import ProviderKind
from app.services.errors import ServiceError, is_external_provider_error

logger = logging.getLogger(__name__)

EmbeddingInputLimitResolver = Callable[[UUID, str], int | None]


def validate_pipeline_definition(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
    *,
    embedding_input_limit: EmbeddingInputLimitResolver | None = None,
) -> PipelineValidationResult:
    """Validate structure and advisory provider limits for one user."""

    def resolve_limit(connection_id: UUID, model_name: str) -> int | None:
        try:
            if embedding_input_limit is not None:
                return embedding_input_limit(connection_id, model_name)
            connection = resolve_connection(session, user, connection_id)
            adapter = get_provider(connection, ProviderKind.EMBEDDING)
            return adapter.embedding_input_limit(model_name)
        except Exception as exc:
            if not isinstance(exc, ServiceError) and not is_external_provider_error(exc):
                raise
            logger.warning(
                "Embedding input limit unavailable for connection=%s model=%s: %s",
                connection_id,
                model_name,
                exc,
            )
            return None

    try:
        definition, _ = resolve_prompt_references(session, user.id, definition)
    except PromptRefError as exc:
        result = PipelineValidator(
            default_registry(),
            embedding_input_limit=resolve_limit,
        ).validate(definition)
        result.issues.append(
            PipelineValidationIssue(
                message=str(exc),
                severity="error",
                node_id=exc.node_id,
                field="prompt_ref",
            )
        )
        return result
    return PipelineValidator(
        default_registry(),
        embedding_input_limit=resolve_limit,
    ).validate(definition)


def log_pipeline_validation_warnings(
    result: PipelineValidationResult,
    *,
    context: str,
) -> None:
    """Surface advisory findings without interrupting a lifecycle operation."""
    for issue in result.issues:
        if issue.severity == "warning":
            logger.warning("Pipeline validation warning during %s: %s", context, issue.message)
