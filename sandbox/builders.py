"""Builders: the reusable steps scenarios compose.

Every builder goes through the app's own service layer — the same code the
routes call — so seeded state is exactly what the running app would have
created, and can never drift from it. Each builder records what it made on
the `SeedContext` (typed attributes for later builders, `facts` lines for
the printed handoff).
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from sandbox import config
from sandbox.context import SeedContext

ASSETS_DIR = Path(__file__).resolve().parent / "assets"


def create_admin_user(
    ctx: SeedContext,
    *,
    email: str = config.SANDBOX_EMAIL,
    password: str = config.SANDBOX_PASSWORD,
) -> None:
    """Register the standard sandbox user (first user → admin) and mint a JWT."""
    from app.core.security import create_access_token
    from app.schemas.auth import UserCreate
    from app.services.accounts import AccountService

    user = AccountService(ctx.session).register(
        UserCreate(email=email, password=password, full_name=config.SANDBOX_FULL_NAME)
    )
    ctx.user = user
    ctx.token = create_access_token(str(user.id))
    ctx.facts.append(f"login: {email} / {password} (role: {user.role})")


def add_provider_connection(ctx: SeedContext, provider: str) -> None:
    """Create a live-validated connection of `provider` type for the seeded user.

    Config is assembled from `.env.sandbox` by `provider_config`, so this works
    for any provider declared in `keys.PROVIDER_SPECS` — an API-key provider or
    a base-URL one (Ollama, TEI). Preflight has already validated it, so a
    missing config here is a harness bug, not user error.
    """
    from app.db.repositories import ProviderConnectionRepository
    from app.schemas.enums import ProviderType
    from app.schemas.providers import ConnectionCreate
    from app.services.connections import ConnectionService
    from sandbox.keys import PROVIDER_SPECS, provider_config

    user = ctx.require_user()
    config = provider_config(provider)
    if config is None:
        raise SystemExit(
            f"{provider} config missing — preflight should have caught this."
        )
    label = f"{PROVIDER_SPECS[provider].display_name} (sandbox)"
    created = ConnectionService(ctx.session).create(
        user,
        ConnectionCreate(
            provider_type=ProviderType(provider),
            label=label,
            config=config,
        ),
    )
    connection = ProviderConnectionRepository(ctx.session).get_owned(created.id, user.id)
    if connection is None:
        raise SystemExit(f"{label} connection vanished after creation.")
    ctx.connection = connection
    ctx.facts.append(f"provider connection: {label} (id {connection.id})")


def add_openrouter_connection(ctx: SeedContext) -> None:
    """Create a live-validated OpenRouter connection (the default provider)."""
    add_provider_connection(ctx, "openrouter")


def create_pgvector_index(
    ctx: SeedContext,
    *,
    embedding_model: str | None = None,
) -> tuple[str, int]:
    """Create the default pgvector dense index sized to the embedding model.

    Probes the model's dimension through the provider (one tiny embed call),
    then creates the index the way the index registry UI would.
    """
    from app.pipelines.nodes.indexing import DEFAULT_PGVECTOR_INDEX_NAME
    from app.providers.registry import get_provider
    from app.schemas.enums import IndexBackend, ProviderKind
    from app.schemas.indexes import IndexCreateRequest
    from app.services.index_admin import IndexAdminService

    user = ctx.require_user()
    connection = ctx.require_connection()
    model = embedding_model or config.default_embedding_model()
    provider = get_provider(connection, ProviderKind.EMBEDDING)
    dimension = provider.embedding_dimension(model)
    if dimension is None:
        raise SystemExit(f"Could not determine embedding dimension for '{model}'.")
    IndexAdminService(ctx.session).create_index(
        user,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR,
            name=DEFAULT_PGVECTOR_INDEX_NAME,
            dimension=dimension,
        ),
    )
    ctx.facts.append(
        f"index: {DEFAULT_PGVECTOR_INDEX_NAME} (pgvector, dense, {dimension}d)"
    )
    return DEFAULT_PGVECTOR_INDEX_NAME, dimension


def bootstrap_setup(
    ctx: SeedContext,
    *,
    index_name: str,
    embedding_dimension: int,
    embedding_model: str | None = None,
    collection_name: str = "Sandbox Collection",
) -> None:
    """Apply the setup wizard's bootstrap: hybrid default pipelines + first collection."""
    from app.schemas.enums import IndexBackend
    from app.schemas.setup import SetupBootstrapRequest
    from app.services.setup import SetupService

    user = ctx.require_user()
    connection = ctx.require_connection()
    result = SetupService(ctx.session).bootstrap(
        user,
        SetupBootstrapRequest(
            embedding_connection_id=connection.id,
            embedding_model=embedding_model or config.default_embedding_model(),
            embedding_dimension=embedding_dimension,
            backend=IndexBackend.PGVECTOR,
            index_name=index_name,
            collection_name=collection_name,
        ),
    )
    ctx.collection = result.collection
    ctx.facts.append(
        f'collection: "{collection_name}" (id {result.collection.id}) '
        "with hybrid default pipelines (dense + BM25, RRF-fused)"
    )
    for warning in result.warnings:
        ctx.facts.append(f"setup warning: {warning.message}")
    ctx.links.append(("collection", f"/collections/{result.collection.id}"))
    ctx.links.append(("collection files", f"/collections/{result.collection.id}/files"))


def ingest_assets(
    ctx: SeedContext,
    *,
    filenames: tuple[str, ...],
) -> list[UUID]:
    """Upload sample documents from ``sandbox/assets/`` and run real ingestion.

    Ingestion is synchronous here (same entry point the background task
    uses), so when this returns the documents are ``ready`` with real chunks
    and vectors — or the seed fails with the document's own error message.
    """
    from app.db import models
    from app.services.files import FileSystemService, UploadSpec
    from app.services.ingestion import run_document_ingestion

    user = ctx.require_user()
    collection = ctx.require_collection()
    service = FileSystemService(ctx.session)
    document_ids: list[UUID] = []
    for filename in filenames:
        path = ASSETS_DIR / filename
        with path.open("rb") as stream:
            result = service.register_upload(
                user,
                collection,
                UploadSpec(filename=filename, content_type="text/markdown"),
                stream,
            )
        if result.document is None:
            raise SystemExit(f"{filename} was not eligible for ingestion.")
        document_ids.append(result.document.id)

    for document_id in document_ids:
        run_document_ingestion(document_id)
        ctx.session.expire_all()
        document = ctx.session.get(models.Document, document_id)
        if document is None or document.status != models.DocumentStatus.READY:
            detail = document.error_message if document else "document row missing"
            raise SystemExit(f"Ingestion failed for {document_id}: {detail}")
        ctx.facts.append(
            f"document: {document.name} (ready, {document.num_chunks} chunks)"
        )
    return document_ids


def seed_eval_dataset(ctx: SeedContext, *, name: str = "Sandbox Eval Dataset") -> None:
    """Persist a small ready BEIR-format eval dataset built from the seeded assets."""
    import json

    from app.evals.service import EvalService

    user = ctx.require_user()
    corpus_rows: list[str] = []
    query_rows: list[str] = []
    qrel_rows: list[str] = []
    for index, (filename, query) in enumerate(ASSET_EVAL_QUERIES.items(), start=1):
        text = (ASSETS_DIR / filename).read_text(encoding="utf-8")
        doc_id, query_id = f"doc{index}", f"q{index}"
        corpus_rows.append(
            json.dumps({"_id": doc_id, "title": filename, "text": text})
        )
        query_rows.append(json.dumps({"_id": query_id, "text": query}))
        qrel_rows.append(f"{query_id}\t{doc_id}\t1")
    dataset = EvalService(ctx.session).upload_dataset(
        user,
        name=name,
        corpus="\n".join(corpus_rows),
        queries="\n".join(query_rows),
        qrels="\n".join(qrel_rows),
        description="Seeded by the sandbox harness from the sample documents.",
    )
    ctx.facts.append(
        f'eval dataset: "{name}" (ready, {dataset.num_queries} queries, '
        f"{dataset.num_corpus_docs} docs)"
    )
    ctx.links.append(("evals", "/evals"))
    ctx.links.append(("eval dataset", f"/evals/datasets/{dataset.id}"))


def repoint_retrieval_embedding(ctx: SeedContext, *, embedding_model: str) -> None:
    """Bind the collection to a retrieval pipeline using a *different* embedding model.

    Creates the drift the diagnostics feature exists to catch: ingestion indexed
    with one model, retrieval queries with another (a different name *and*
    dimension), so the embedding-mismatch diagnostic fires and a real search
    fails at the retriever with a dimension mismatch — the trace-backed failure
    path. Goes through `PipelineService` like the pipeline builder would.
    """
    from app.db import models
    from app.pipelines.defaults import build_default_retrieval_pipeline
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
    connection = ctx.require_connection()
    collection = ctx.require_collection()
    pipeline = PipelineService(ctx.session).create_pipeline(
        user=user,
        name="Retrieval (divergent embedding)",
        description="Retrieval re-pointed at a different embedding model to exercise diagnostics.",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=connection.id, embedding_model=embedding_model
        ),
        change_summary="Divergent embedding model for diagnostics scenario.",
    )
    ctx.session.flush()
    from app.db.repositories import CollectionPipelineBindingRepository

    bindings = CollectionPipelineBindingRepository(ctx.session)
    tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
    primary = next((b for b in tools if b.is_primary), tools[0] if tools else None)
    if primary is None:
        bindings.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=pipeline.id,
                role=models.BindingRole.TOOL,
                is_primary=True,
            )
        )
    else:
        primary.pipeline_id = pipeline.id
        ctx.session.add(primary)
    ctx.session.commit()
    ctx.facts.append(
        f"retrieval re-pointed to embedding model '{embedding_model}' "
        "(ingestion still indexed with the default) — embedding_model_mismatch diagnostic"
    )
    ctx.links.append(("diagnostics", f"/collections/{collection.id}/diagnostics"))
    ctx.links.append(("search (fails)", f"/collections/{collection.id}/search"))


SAMPLE_DOCUMENTS: tuple[str, ...] = (
    "aurora-station.md",
    "tidepool-protocol.md",
    "glasswing-archive.md",
)

ASSET_EVAL_QUERIES: dict[str, str] = {
    "aurora-station.md": "How is power generated aboard Aurora Station?",
    "tidepool-protocol.md": "What triggers a Tidepool consensus round?",
    "glasswing-archive.md": "How does the Glasswing Archive deduplicate records?",
}


def issue_mcp_key(ctx: SeedContext, *, name: str = "Sandbox agent") -> None:
    """Issue a full-capability MCP key for the seeded collection.

    All three capabilities are granted because the scenario exists to exercise
    the whole MCP surface; a narrower key is what the capability-filtering tests
    cover.
    """
    from app.schemas.api_keys import ApiKeyCreate
    from app.schemas.enums import ApiKeyCapability
    from app.services.api_keys import ApiKeyService

    user = ctx.require_user()
    collection = ctx.require_collection()
    _, secret = ApiKeyService(ctx.session).issue(
        user,
        ApiKeyCreate(
            name=name,
            capabilities=[
                ApiKeyCapability.TOOLS_INVOKE,
                ApiKeyCapability.FILES_READ,
                ApiKeyCapability.FILES_WRITE,
            ],
            collection_ids=[collection.id],
        ),
    )
    ctx.session.commit()
    ctx.api_key_secret = secret
    ctx.facts.append(
        f'mcp key: "{name}" (tools:invoke, files:read, files:write) for '
        f"collection {collection.name}"
    )
    ctx.facts.append(
        f"mcp endpoint: {config.API_BASE_URL}/api/mcp/collections/{collection.id}"
    )
    ctx.links.append(("collection overview (MCP card)", f"/collections/{collection.id}"))


def add_second_collection_on_copied_pipelines(
    ctx: SeedContext,
    *,
    name: str = "Second Collection",
    index_name: str = "second-index",
) -> None:
    """Give a second collection its own indexes by copying the pipelines.

    A pipeline names the index it uses, so two collections on two stores are
    two pipelines. Copying is the supported way to get the second one: the
    graph is duplicated, its store nodes repointed, and the new collection
    bound to the copies. The first collection is untouched, which is the
    property that matters — editing one graph must never move another
    collection's corpus.
    """
    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.pipelines.index_identity import is_lexical_node, store_bound_node
    from app.pipelines.registry import default_registry
    from app.schemas.collections import CollectionCreate, CollectionUpdate
    from app.schemas.enums import IndexBackend
    from app.schemas.indexes import IndexCreateRequest
    from app.services.collection_tools import CollectionToolService
    from app.services.collections import CollectionService
    from app.services.index_admin import IndexAdminService
    from app.services.index_scaffolding import register_definition_indexes
    from app.services.pipeline_defaults import DEFAULT_INGEST_SLUG
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
    admin = IndexAdminService(ctx.session)
    dimension = next(
        (
            index.dimension
            for index in admin.list_indexes(user, IndexBackend.PGVECTOR)
            if index.dimension
        ),
        None,
    )
    if dimension is None:
        raise SystemExit("No dense pgvector index to size the second index from.")

    # Both planes, because the default pipelines are hybrid: pointing a BM25
    # node at a dense index would return nothing with no error to explain it.
    admin.create_index(
        user,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name=index_name, dimension=dimension
        ),
    )
    admin.create_index(
        user,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR,
            name=f"{index_name}-bm25",
            vector_type="sparse",
        ),
    )

    registry = default_registry()
    pipelines = PipelineService(ctx.session)
    copies: dict[str, UUID] = {}
    for original in pipelines.list_pipelines(user.id):
        if not original.template_slug:
            continue
        copy = pipelines.copy_pipeline(user, original, name=f"{original.name} (second)")
        ctx.session.flush()
        definition = pipelines.get_definition(copy)
        nodes = []
        for node in definition.nodes:
            config = dict(node.config or {})
            if store_bound_node(node.type, registry) and isinstance(
                config.get("index_name"), str
            ):
                config["index_name"] = (
                    f"{index_name}-bm25" if is_lexical_node(node.type) else index_name
                )
            nodes.append(node.model_copy(update={"config": config}))
        repointed = definition.model_copy(update={"nodes": nodes})
        pipelines.update_pipeline(
            pipeline=copy,
            definition=register_definition_indexes(ctx.session, user, repointed),
            change_summary=f"Point at {index_name}.",
            actor_id=user.id,
        )
        copies[original.template_slug] = copy.id
    ctx.session.commit()

    second = CollectionService(ctx.session).create(
        user,
        CollectionCreate(
            name=name,
            description="Runs copies of the first collection's pipelines.",
        ),
    )
    ctx.session.flush()
    tools = CollectionToolService(ctx.session)
    for slug, pipeline_id in copies.items():
        if slug == DEFAULT_INGEST_SLUG:
            CollectionService(ctx.session).update(
                second, CollectionUpdate(ingest_pipeline_id=pipeline_id), user
            )
            continue
        # The collection was created with the *default* search tool bound;
        # swap it for the copy so the second collection shares no pipeline
        # with the first.
        for binding in CollectionPipelineBindingRepository(
            ctx.session
        ).list_for_collection(second.id):
            if binding.role == models.BindingRole.TOOL:
                tools.remove_tool(user, second, binding.id)
        tools.add_tool(user, second, pipeline_id)
    ctx.session.commit()
    ctx.facts.append(
        f'collection: "{name}" on copied pipelines writing to {index_name}'
    )
    ctx.links.append((f"{name} overview", f"/collections/{second.id}"))


def add_pinecone_index(
    ctx: SeedContext,
    *,
    index_name: str = "sandbox-remote",
    dimension: int | None = None,
) -> None:
    """Register a dense *and* a sparse Pinecone index beside the pgvector ones.

    Gives the sandbox both backends at once, which is what a backend swap
    needs: the capability check only has something to say when an index on a
    *different* backend is actually selectable.

    Both planes, because a slot's vector type is derived from the nodes
    reading it. A lexical slot offered only a dense Pinecone index is refused
    for being dense long before any backend capability is consulted, so a
    scenario with no sparse Pinecone index cannot reach the capability
    refusal at all.
    """
    from app.schemas.enums import IndexBackend

    user = ctx.require_user()
    if dimension is None:
        from app.services.index_admin import IndexAdminService

        dimension = next(
            (
                index.dimension
                for index in IndexAdminService(ctx.session).list_indexes(
                    user, IndexBackend.PGVECTOR
                )
                if index.dimension
            ),
            None,
        )
    if dimension is None:
        raise SystemExit("No dense index to size the Pinecone index from.")

    sparse_name = f"{index_name}-bm25"
    _adopt_or_create_pinecone_index(ctx, name=index_name, dimension=dimension)
    _adopt_or_create_pinecone_index(ctx, name=sparse_name, vector_type="sparse")
    ctx.session.commit()
    ctx.facts.append(
        f"index: {index_name} (pinecone, dense, {dimension}d) and {sparse_name} "
        "(pinecone, sparse) — registered and selectable, so a binding can be "
        "swapped onto another backend on either plane"
    )


def _adopt_or_create_pinecone_index(
    ctx: SeedContext,
    *,
    name: str,
    dimension: int | None = None,
    vector_type: str = "dense",
) -> None:
    """Create the Pinecone index, or adopt it when it already exists.

    A Pinecone index is a real remote resource that outlives a reseed, so a
    plain create fails on the 409 the second time. This is the same
    register-or-create path the index registry offers.
    """
    from app.schemas.enums import IndexBackend
    from app.schemas.indexes import IndexCreateRequest, IndexRegisterRequest
    from app.services.errors import NotFoundError
    from app.services.index_admin import IndexAdminService

    user = ctx.require_user()
    admin = IndexAdminService(ctx.session)
    try:
        admin.describe_index(user, IndexBackend.PINECONE, name)
    except NotFoundError:
        admin.create_index(
            user,
            IndexCreateRequest(
                backend=IndexBackend.PINECONE,
                name=name,
                vector_type=vector_type,
                dimension=dimension,
                cloud="aws",
                region="us-east-1",
            ),
        )
    else:
        admin.register_index(
            user, IndexRegisterRequest(backend=IndexBackend.PINECONE, name=name)
        )


def ingest_generated_documents(
    ctx: SeedContext,
    *,
    documents: list[tuple[str, str]],
) -> None:
    """Upload and ingest in-memory documents through the real pipeline.

    The per-ingest insight hook is held off for the duration: one hundred
    sequential triggers would race the seeding process's exit, and the
    scenario computes one synchronous snapshot at the end instead
    (`compute_insights`), so the seeded state never ships a half-built map.
    """
    import io
    from unittest import mock

    from app.db import models
    from app.services.files import FileSystemService, UploadSpec
    from app.services.ingestion import run_document_ingestion

    user = ctx.require_user()
    collection = ctx.require_collection()
    service = FileSystemService(ctx.session)
    document_ids: list[UUID] = []
    for filename, text in documents:
        result = service.register_upload(
            user,
            collection,
            UploadSpec(filename=filename, content_type="text/plain"),
            io.BytesIO(text.encode("utf-8")),
        )
        if result.document is None:
            raise SystemExit(f"{filename} was not eligible for ingestion.")
        document_ids.append(result.document.id)

    chunk_total = 0
    with mock.patch(
        "app.services.ingestion.schedule_insight_refresh", return_value=False
    ):
        for document_id in document_ids:
            run_document_ingestion(document_id)
            ctx.session.expire_all()
            document = ctx.session.get(models.Document, document_id)
            if document is None or document.status != models.DocumentStatus.READY:
                detail = document.error_message if document else "document row missing"
                raise SystemExit(f"Ingestion failed for {document_id}: {detail}")
            chunk_total += document.num_chunks
    ctx.facts.append(
        f"documents: {len(document_ids)} ingested, {chunk_total} chunks total"
    )


def compute_insights(ctx: SeedContext) -> None:
    """Build the collection's insight snapshot synchronously.

    The running app maintains snapshots from its ingestion hook; seeding
    computes one here so the Visualize page is served, not still computing,
    the moment the sandbox hands over.
    """
    from app.schemas.enums import InsightSpace
    from app.visualization.insights.service import InsightService

    user = ctx.require_user()
    collection = ctx.require_collection()
    service = InsightService(ctx.session)
    marker = service.begin_refresh(collection.id, user.id)
    if marker is None:
        raise SystemExit("Insight refresh could not start (marker already pending).")
    service.run_refresh(marker)
    snapshot = service.ready_snapshot(collection.id)
    ctx.facts.append(
        # DB-loaded enum columns are raw strings; normalize before .value.
        f"insights: {InsightSpace(snapshot.space).value} snapshot ready — {snapshot.point_count} "
        f"chunks, {snapshot.document_count} documents, {snapshot.cluster_count} clusters"
    )
    ctx.links.append(
        ("collection visualize", f"/collections/{collection.id}/visualize")
    )
