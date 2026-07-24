"""Default-pipeline scaffolding: per-user defaults and collection bindings.

Split from `app/services/pipelines.py` (which owns pipeline CRUD/versioning):
this module owns how a user's default ingest/search pipelines come to exist,
rotate when the deployment backend changes, and get bound onto collections
that have no bindings yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    UserRepository,
)
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_static_definition
from app.pipelines.settings import resolve_definition_backend
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError

if TYPE_CHECKING:
    from app.services.pipelines import PipelineService

#: Template slugs marking a user's scaffolded default pipelines.
DEFAULT_INGEST_SLUG = "default-ingest"
DEFAULT_SEARCH_SLUG = "default-search"
#: Optional wizard-scaffolded tool pipelines (see `app/pipelines/tool_defaults.py`).
DEFAULT_COUNT_SLUG = "default-count"
DEFAULT_FACET_SLUG = "default-facet"


@dataclass
class DefaultPipelines:
    """Container for a user's default ingest and search pipelines."""

    ingestion: models.Pipeline
    retrieval: models.Pipeline


def ensure_default_pipelines(
    service: PipelineService, user: models.User
) -> DefaultPipelines:
    """Ensure default ingest/search pipelines on the configured backend.

    A stored default whose vector-store backend no longer matches the
    deployment's `indexing.default_backend` is demoted (kept, renamed with
    its backend, still bound by existing collections) and a fresh default
    is re-scaffolded around the demoted pipeline's own embedder — so new
    collections always index into the configured backend while old
    collections keep their data. There are no global default models: a
    user with no defaults at all (first-run setup never completed) raises
    `InvalidInputError` pointing at the wizard, which scaffolds with an
    explicit embedding choice.
    """
    configured = IndexBackend(get_app_config().indexing.default_backend)
    stored_ingestion = service.get_by_template_slug(user.id, DEFAULT_INGEST_SLUG)
    stored_retrieval = service.get_by_template_slug(user.id, DEFAULT_SEARCH_SLUG)
    ingestion = _demote_if_backend_stale(service, stored_ingestion, configured)
    retrieval = _demote_if_backend_stale(service, stored_retrieval, configured)

    if ingestion is None:
        embedding = _embedding_selection_from(service, stored_ingestion or stored_retrieval)
        ingestion = service.create_pipeline(
            user=user,
            name="Default Ingestion Pipeline",
            description="Baseline ingestion pipeline for uploads.",
            definition=build_default_ingestion_pipeline(
                embedding_connection_id=embedding[0],
                embedding_model=embedding[1],
            ),
            change_summary="Initial default ingestion pipeline.",
            template_slug=DEFAULT_INGEST_SLUG,
        )
    if retrieval is None:
        embedding = _embedding_selection_from(
            service, stored_retrieval or stored_ingestion or ingestion
        )
        retrieval = service.create_pipeline(
            user=user,
            name="Default Retrieval Pipeline",
            description="Baseline retrieval pipeline for queries.",
            definition=build_default_retrieval_pipeline(
                embedding_connection_id=embedding[0],
                embedding_model=embedding[1],
            ),
            change_summary="Initial default retrieval pipeline.",
            template_slug=DEFAULT_SEARCH_SLUG,
        )
    return DefaultPipelines(ingestion=ingestion, retrieval=retrieval)


def _embedding_selection_from(
    service: PipelineService, pipeline: models.Pipeline | None
) -> tuple[UUID, str]:
    """Read `(connection_id, model)` off an existing pipeline's embedder.

    Scaffolding a default needs an embedding choice, and with global
    default models removed the only legitimate source outside the setup
    wizard is an existing pipeline (e.g. the default demoted for a
    backend change).
    """
    if pipeline is not None:
        version = service.get_current_version(pipeline)
        stored = PipelineDefinition.model_validate(version.definition)
        definition = resolve_static_definition(stored)
        for node in definition.nodes:
            if node.type != EmbedderNode.type:
                continue
            config = EmbedderConfig.model_validate(node.config or {})
            if config.connection_id and config.model_name:
                return config.connection_id, config.model_name
    raise InvalidInputError(
        "No default pipelines exist yet. Complete the first-time setup "
        "wizard (or create a collection with an explicit embedding model) "
        "before this operation."
    )


def _demote_if_backend_stale(
    service: PipelineService,
    pipeline: models.Pipeline | None,
    configured: IndexBackend,
) -> models.Pipeline | None:
    """Demote a default pipeline whose backend no longer matches config."""
    if pipeline is None:
        return None
    version = service.get_current_version(pipeline)
    definition = PipelineDefinition.model_validate(version.definition)
    backend = resolve_definition_backend(definition, default_registry())
    if backend is configured:
        return pipeline
    pipeline.template_slug = None
    pipeline.name = f"{pipeline.name} ({backend.value})"
    service.session.add(pipeline)
    return None


def ensure_collection_bindings(
    session: Session,
    collection: models.Collection,
    defaults: DefaultPipelines,
) -> models.Collection:
    """Bind default pipelines to a collection missing ingest/tool bindings."""
    bindings = CollectionPipelineBindingRepository(session)
    existing = bindings.list_for_collection(collection.id)
    has_ingest = any(binding.role == models.BindingRole.INGEST for binding in existing)
    tools = [binding for binding in existing if binding.role == models.BindingRole.TOOL]
    if not has_ingest:
        bindings.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=defaults.ingestion.id,
                role=models.BindingRole.INGEST,
            )
        )
    if not tools:
        bindings.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=defaults.retrieval.id,
                role=models.BindingRole.TOOL,
                is_primary=True,
            )
        )
    return collection


def backfill_default_pipelines(session: Session) -> None:
    """Ensure all users and collections have default pipelines bound.

    A user with no defaults on an install with no configured embedding model
    is skipped, not failed: they haven't completed first-run setup yet, and
    the wizard scaffolds their defaults with an explicit model when they do.
    """
    from app.services.pipelines import PipelineService

    service = PipelineService(session)
    collection_repo = CollectionRepository(session)
    for user in UserRepository(session).list_all():
        try:
            defaults = ensure_default_pipelines(service, user)
        except InvalidInputError:
            continue
        for collection in collection_repo.list_for_user(user.id):
            ensure_collection_bindings(session, collection, defaults)
