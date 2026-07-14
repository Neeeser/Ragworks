"""First-run setup: derived readiness status and the one-shot bootstrap.

`status` derives readiness from real state (provider connections covering
embedding/chat/vector-store, an index the user can reach, a collection) so it
can never drift from reality. `bootstrap` applies the wizard's confirmed
choices in one transaction: default ingestion and retrieval pipelines built
around the chosen connection/model/index and the first collection attached to
them. There are no global default models to seed — the embedding choice lives
inside the scaffolded pipeline definitions.
"""

from __future__ import annotations

import logging
from contextlib import suppress
from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.db.pgvector_support import pgvector_available
from app.db.repositories import CollectionRepository, ProviderConnectionRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import PipelineDefinition
from app.providers.registry import build_adapter, get_provider, resolve_connection
from app.schemas.enums import IndexBackend, ProviderKind
from app.schemas.setup import SetupBootstrapRequest, SetupStatusRead
from app.services.errors import (
    InvalidInputError,
    NotFoundError,
    ServiceError,
    is_external_provider_error,
)
from app.services.pipelines import PipelineService
from app.telemetry import record
from app.telemetry.events import CollectionCreated
from app.vectorstores.base import VectorIndexDescription
from app.vectorstores.registry import get_vector_store

logger = logging.getLogger(__name__)


class SetupService:
    """Derive first-run readiness and install the wizard's choices."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self._collections = CollectionRepository(session)
        self._pipelines = PipelineService(session)

    def status(self, user: models.User) -> SetupStatusRead:
        """Return derived readiness for this user."""
        coverage = self._provider_coverage(user)
        has_index = self._has_index(user)
        has_collection = bool(self._collections.list_for_user(user.id))
        providers_ready = all(coverage[kind] for kind in ProviderKind)
        return SetupStatusRead(
            has_embedding_provider=coverage[ProviderKind.EMBEDDING],
            has_chat_provider=coverage[ProviderKind.CHAT],
            has_vector_store=coverage[ProviderKind.VECTOR_STORE],
            has_index=has_index,
            has_collection=has_collection,
            setup_complete=providers_ready and has_index and has_collection,
        )

    def _provider_coverage(self, user: models.User) -> dict[ProviderKind, bool]:
        """Which kinds the user's connections (plus built-in pgvector) cover."""
        coverage = {kind: False for kind in ProviderKind}
        if pgvector_available():
            coverage[ProviderKind.VECTOR_STORE] = True
        for connection in ProviderConnectionRepository(self.session).list_for_user(user.id):
            try:
                descriptor = build_adapter(connection).descriptor
            except InvalidInputError:
                continue
            for kind in descriptor.kinds:
                coverage[kind] = True
        return coverage

    def bootstrap(self, user: models.User, payload: SetupBootstrapRequest) -> models.Collection:
        """Install default pipelines and the first collection in one commit."""
        connection = resolve_connection(self.session, user, payload.embedding_connection_id)
        get_provider(connection, ProviderKind.EMBEDDING)
        self._validate_index(user, payload)
        defaults = self._install_default_pipelines(user, payload)
        collection = models.Collection(
            id=uuid4(),
            user_id=user.id,
            name=payload.collection_name,
            description=None,
            ingestion_pipeline_id=defaults[models.PipelineKind.INGESTION].id,
            retrieval_pipeline_id=defaults[models.PipelineKind.RETRIEVAL].id,
            extra_metadata={},
        )
        self._collections.add(collection)
        self.session.commit()
        self.session.refresh(collection)
        record(CollectionCreated(user_id=user.id, collection_id=collection.id))
        return collection

    def _has_index(self, user: models.User) -> bool:
        """True when any reachable backend holds at least one index.

        A backend whose provider is unreachable (or whose prerequisite is
        missing) counts as index-less rather than failing status -- readiness
        must always be answerable.
        """
        for backend in IndexBackend:
            try:
                store = get_vector_store(backend, user=user, session=self.session)
                if store.list_indexes():
                    return True
            except ServiceError:
                continue
            except Exception as exc:  # pylint: disable=broad-exception-caught
                if not is_external_provider_error(exc):
                    raise
                logger.warning("Skipping %s while deriving setup status: %s", backend, exc)
        return False

    def _validate_index(self, user: models.User, payload: SetupBootstrapRequest) -> None:
        """Ensure the chosen index exists and matches the model's dimension."""
        try:
            store = get_vector_store(payload.backend, user=user, session=self.session)
            description: VectorIndexDescription = store.describe_index(payload.index_name)
        except NotFoundError as exc:
            raise InvalidInputError(
                f"Index '{payload.index_name}' was not found on "
                f"{payload.backend.value}. Create it before finishing setup."
            ) from exc
        if (
            payload.embedding_dimension is not None
            and description.dimension is not None
            and description.dimension != payload.embedding_dimension
        ):
            raise InvalidInputError(
                f"Index '{payload.index_name}' has dimension "
                f"{description.dimension}, but '{payload.embedding_model}' "
                f"produces {payload.embedding_dimension}-dimension vectors."
            )

    def _install_default_pipelines(
        self, user: models.User, payload: SetupBootstrapRequest
    ) -> dict[models.PipelineKind, models.Pipeline]:
        """Create (or refresh) the default pipelines from the wizard's choices."""
        definitions: dict[models.PipelineKind, PipelineDefinition] = {
            models.PipelineKind.INGESTION: build_default_ingestion_pipeline(
                embedding_connection_id=payload.embedding_connection_id,
                embedding_model=payload.embedding_model,
                backend=payload.backend,
                index_name=payload.index_name,
                chunk_size=payload.chunk_size,
                chunk_overlap=payload.chunk_overlap,
            ),
            models.PipelineKind.RETRIEVAL: build_default_retrieval_pipeline(
                embedding_connection_id=payload.embedding_connection_id,
                embedding_model=payload.embedding_model,
                backend=payload.backend,
                index_name=payload.index_name,
            ),
        }
        installed: dict[models.PipelineKind, models.Pipeline] = {}
        for kind, definition in definitions.items():
            existing = next(
                (
                    pipeline
                    for pipeline in self._pipelines.list_pipelines(user.id, kind=kind)
                    if pipeline.is_default
                ),
                None,
            )
            if existing is None:
                label = "Ingestion" if kind == models.PipelineKind.INGESTION else "Retrieval"
                installed[kind] = self._pipelines.create_pipeline(
                    user=user,
                    name=f"Default {label} Pipeline",
                    description=f"Baseline {label.lower()} pipeline from first-run setup.",
                    kind=kind,
                    definition=definition,
                    change_summary="First-run setup.",
                    is_default=True,
                )
            else:
                # An identical definition raises "no changes" -- that is
                # already the desired end state, so suppress it.
                with suppress(InvalidInputError):
                    self._pipelines.update_pipeline(
                        pipeline=existing,
                        definition=definition,
                        change_summary="First-run setup re-applied.",
                        actor_id=user.id,
                    )
                installed[kind] = existing
        return installed
