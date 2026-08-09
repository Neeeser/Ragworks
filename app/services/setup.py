"""First-run setup: derived readiness status and the one-shot bootstrap.

`status` derives readiness from real state (provider connections covering
embedding/chat/vector-store, an index the user has registered, a collection)
so it can never drift from reality. `bootstrap` applies the wizard's confirmed
choices in one transaction: the hybrid ingestion and search pipelines built
around the chosen connection/model/index, and the first collection bound to
them. There are no global default models to seed — the embedding choice lives
inside the scaffolded pipeline definitions.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.db.pgvector_support import pgvector_available
from app.db.repositories import (
    CollectionRepository,
    PipelineRepository,
    ProviderConnectionRepository,
    RegisteredIndexRepository,
)
from app.pipelines.defaults import (
    bm25_sibling_index_name,
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.tool_defaults import (
    build_count_tool_pipeline,
    build_facet_tool_pipeline,
    with_reranker,
)
from app.providers.base import effective_embedding_input_limit
from app.providers.registry import build_adapter, get_provider, resolve_connection
from app.schemas.enums import ProviderKind
from app.schemas.setup import SetupBootstrapRequest, SetupStatusRead
from app.services.collection_tools import CollectionToolService
from app.services.connections import connection_kinds
from app.services.errors import InvalidInputError, NotFoundError
from app.services.index_scaffolding import register_definition_indexes
from app.services.pipeline_scaffolds import DEFAULT_COUNT_SLUG, DEFAULT_FACET_SLUG
from app.services.pipelines import (
    DEFAULT_INGEST_SLUG,
    DEFAULT_SEARCH_SLUG,
    PipelineService,
)
from app.telemetry import record
from app.telemetry.events import CollectionCreated
from app.vectorstores.base import VectorIndexDescription
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, get_vector_store

#: Pipeline entity name + description per scaffolded slug (distinct from the
#: tool name exposed to the assistant, which lives in the node config). Each
#: names the graph it installs rather than its standing: these are ordinary
#: pipelines a user edits, copies, or unbinds like any other, and a name that
#: claims otherwise reads as the one they are meant to keep.
_PIPELINE_LABELS: dict[str, tuple[str, str]] = {
    DEFAULT_INGEST_SLUG: (
        "Hybrid Ingestion",
        "Chunks and embeds uploads into a semantic index, and the same chunks "
        "into a BM25 index beside it.",
    ),
    DEFAULT_SEARCH_SLUG: (
        "Hybrid Search",
        "Semantic and BM25 retrieval fused by reciprocal rank.",
    ),
    DEFAULT_COUNT_SLUG: (
        "Count Matches",
        "Counts the documents and chunks matching a query.",
    ),
    DEFAULT_FACET_SLUG: (
        "Facet by Source",
        "Groups matching chunks by source file.",
    ),
}

#: What the search scaffold is called when the wizard splices a reranker in —
#: the graph differs, so the name does too.
_RERANKED_SEARCH_LABEL = (
    "Reranked Search",
    "Semantic and BM25 retrieval fused by reciprocal rank, then reordered by "
    "a reranking model.",
)


def _scaffold_labels(slug: str, payload: SetupBootstrapRequest) -> tuple[str, str]:
    """Return the name and description for a scaffolded slug."""
    if slug == DEFAULT_SEARCH_SLUG and payload.reranker is not None:
        return _RERANKED_SEARCH_LABEL
    return _PIPELINE_LABELS[slug]


@dataclass(frozen=True)
class SetupBootstrapResult:
    """The created collection and non-blocking pipeline findings."""

    collection: models.Collection
    warnings: list[PipelineValidationIssue]


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
        # Setup needs exactly these kinds — never `all(ProviderKind)`, which
        # silently strengthens the gate whenever the enum grows (adding
        # RERANKING once trapped users in the wizard on every page load).
        providers_ready = all(
            coverage[kind]
            for kind in (ProviderKind.EMBEDDING, ProviderKind.CHAT, ProviderKind.VECTOR_STORE)
        )
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
        coverage = dict.fromkeys(ProviderKind, False)
        if pgvector_available():
            coverage[ProviderKind.VECTOR_STORE] = True
        for connection in ProviderConnectionRepository(self.session).list_for_user(user.id):
            try:
                adapter = build_adapter(connection)
            except InvalidInputError:
                continue
            # The connection's real capabilities, not its provider type's:
            # a custom server saved as embeddings-only would otherwise satisfy
            # the chat gate, and the wizard would hand the user a finished
            # console whose model picker is empty.
            for kind in connection_kinds(adapter):
                coverage[kind] = True
        return coverage

    def bootstrap(self, user: models.User, payload: SetupBootstrapRequest) -> SetupBootstrapResult:
        """Install the wizard's pipelines and the first collection in one commit."""
        connection = resolve_connection(self.session, user, payload.embedding_connection_id)
        embedding_provider = get_provider(connection, ProviderKind.EMBEDDING)
        published_limit = embedding_provider.embedding_input_limit(payload.embedding_model)
        effective_limit = (
            effective_embedding_input_limit(published_limit)
            if published_limit is not None
            else None
        )
        self._validate_index(user, payload)
        installed, warnings = self._install_scaffolded_pipelines(user, payload, effective_limit)
        collection = models.Collection(
            id=uuid4(),
            user_id=user.id,
            name=payload.collection_name,
            description=None,
            extra_metadata={},
        )
        self._collections.add(collection)
        self.session.flush()
        tools = CollectionToolService(self.session)
        tools.set_ingest_pipeline(user, collection, installed[DEFAULT_INGEST_SLUG].id)
        # Search binds first so it stays the collection's primary tool; the
        # optional aggregate tools bind after it in a stable order.
        tools.add_tool(user, collection, installed[DEFAULT_SEARCH_SLUG].id)
        for slug in (DEFAULT_COUNT_SLUG, DEFAULT_FACET_SLUG):
            if slug in installed:
                tools.add_tool(user, collection, installed[slug].id)
        self.session.commit()
        self.session.refresh(collection)
        record(CollectionCreated(user_id=user.id, collection_id=collection.id))
        return SetupBootstrapResult(collection=collection, warnings=warnings)

    def _has_index(self, user: models.User) -> bool:
        """True when *this user* has registered at least one index.

        Registration is the readiness signal, not the store's own listing: a
        pgvector name is shared workspace-wide, so listing physical indexes
        reports another account's index as this user's readiness and the
        wizard would treat an index they cannot select as their own. Only a
        registered index is selectable by a binding, which is exactly what
        "ready" has to mean here.
        """
        return bool(RegisteredIndexRepository(self.session).list_for_user(user.id))

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

    def _install_scaffolded_pipelines(
        self,
        user: models.User,
        payload: SetupBootstrapRequest,
        embedding_input_limit: int | None = None,
    ) -> tuple[
        dict[str, models.Pipeline],
        list[PipelineValidationIssue],
    ]:
        """Create (or refresh) the wizard's pipelines from its confirmed choices."""
        search = build_default_retrieval_pipeline(
            embedding_connection_id=payload.embedding_connection_id,
            embedding_model=payload.embedding_model,
            backend=payload.backend,
            index_name=payload.index_name,
        )
        if payload.reranker is not None:
            search = with_reranker(
                search,
                connection_id=payload.reranker.connection_id,
                model_name=payload.reranker.model_name,
            )
        definitions: dict[str, PipelineDefinition] = {
            DEFAULT_INGEST_SLUG: build_default_ingestion_pipeline(
                embedding_connection_id=payload.embedding_connection_id,
                embedding_model=payload.embedding_model,
                backend=payload.backend,
                index_name=payload.index_name,
                chunk_size=payload.chunk_size,
                chunk_overlap=payload.chunk_overlap,
                embedding_input_limit=embedding_input_limit,
            ),
            DEFAULT_SEARCH_SLUG: search,
        }
        definitions.update(self._aggregate_tool_definitions(payload))
        # Registered here, not per-branch below: the wizard is a scaffolding
        # path like default scaffolding, so its pipelines must ship in the same
        # index-variable shape or the collection could never repoint them.
        definitions = {
            slug: register_definition_indexes(self.session, user, definition)
            for slug, definition in definitions.items()
        }
        warnings = [
            issue
            for definition in definitions.values()
            for issue in self._pipelines.validate_definition(user, definition).issues
            if issue.severity == "warning"
        ]
        installed: dict[str, models.Pipeline] = {}
        for slug, definition in definitions.items():
            existing = PipelineRepository(self.session).get_by_template_slug(user.id, slug)
            if existing is None:
                name, description = _scaffold_labels(slug, payload)
                installed[slug] = self._pipelines.create_pipeline(
                    user=user,
                    name=name,
                    description=description,
                    definition=definition,
                    change_summary="First-run setup.",
                    template_slug=slug,
                )
            else:
                # An identical generated definition is already the desired end
                # state. Other InvalidInputErrors (including provider limits)
                # must remain visible to the setup caller.
                if self._pipelines.get_definition(existing) != definition:
                    self._pipelines.update_pipeline(
                        pipeline=existing,
                        definition=definition,
                        change_summary="First-run setup re-applied.",
                        actor_id=user.id,
                    )
                installed[slug] = existing
        return installed, warnings

    def _aggregate_tool_definitions(
        self, payload: SetupBootstrapRequest
    ) -> dict[str, PipelineDefinition]:
        """Build the optional count/facet tool definitions the wizard requested.

        Each is gated on the chosen backend advertising the matching lexical
        capability, so a flag set against a backend that can't serve it (e.g.
        Pinecone) is silently skipped rather than scaffolding a broken tool —
        the wizard gates the checkboxes on the same capability.
        """
        capabilities = CAPABILITIES_BY_BACKEND[payload.backend]
        definitions: dict[str, PipelineDefinition] = {}
        # The wizard collects the dense index; these tools read the BM25
        # sibling the hybrid ingestion pipeline writes beside it.
        lexical_index = bm25_sibling_index_name(payload.index_name, payload.backend)
        if payload.add_count_tool and capabilities.supports_lexical_count:
            definitions[DEFAULT_COUNT_SLUG] = build_count_tool_pipeline(
                backend=payload.backend, index_name=lexical_index
            )
        if payload.add_facet_tool and capabilities.supports_lexical_facet:
            definitions[DEFAULT_FACET_SLUG] = build_facet_tool_pipeline(
                backend=payload.backend, index_name=lexical_index
            )
        return definitions
