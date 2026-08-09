"""Builders: the reusable steps scenarios compose.

Every builder goes through the app's own service layer — the same code the
routes call — so seeded state is exactly what the running app would have
created, and can never drift from it. Each builder records what it made on
the `SeedContext` (typed attributes for later builders, `facts` lines for
the printed handoff).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from sandbox import config
from sandbox.context import SeedContext

if TYPE_CHECKING:  # Annotations only — app imports stay inside function bodies.
    from app.db import models

ASSETS_DIR = Path(__file__).resolve().parent / "assets"

#: Tool identity given to a copied search tool, so it and its original
#: can be bound to one collection (a shared base name is refused at bind time).
COPIED_TOOL_NAME = "search_second"


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


def add_downed_provider_connection(ctx: SeedContext, *, label: str = "Ollama (homelab)") -> None:
    """Create an Ollama connection whose server then goes away.

    The app refuses to save a connection it cannot reach, so this is the only
    honest way to seed one: a throwaway server answers the validation probe
    (`GET /api/version`), the connection is created through the real service
    against it, and the server shuts down — leaving exactly the state a user
    reaches when their local Ollama box goes offline after being configured.
    Listing models against it then fails per connection, which is what every
    provider-failure surface renders from.
    """
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    from app.db.repositories import ProviderConnectionRepository
    from app.schemas.enums import ProviderType
    from app.schemas.providers import ConnectionCreate
    from app.services.connections import ConnectionService

    class _VersionOnly(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = json.dumps({"version": "0.0.0-sandbox"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            """Stay out of the seeding output."""

    server = HTTPServer(("127.0.0.1", 0), _VersionOnly)
    base_url = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        user = ctx.require_user()
        created = ConnectionService(ctx.session).create(
            user,
            ConnectionCreate(
                provider_type=ProviderType.OLLAMA,
                label=label,
                config={"base_url": base_url},
            ),
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    owner_id = ctx.require_user().id
    connection = ProviderConnectionRepository(ctx.session).get_owned(created.id, owner_id)
    if connection is None:
        raise SystemExit(f"{label} connection vanished after creation.")
    ctx.facts.append(f"unreachable provider connection: {label} at {base_url} (id {connection.id})")


def create_pgvector_index(
    ctx: SeedContext,
    *,
    embedding_model: str | None = None,
    name: str | None = None,
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
    index_name = name or DEFAULT_PGVECTOR_INDEX_NAME
    provider = get_provider(connection, ProviderKind.EMBEDDING)
    dimension = provider.embedding_dimension(model)
    if dimension is None:
        raise SystemExit(f"Could not determine embedding dimension for '{model}'.")
    IndexAdminService(ctx.session).create_index(
        user,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR,
            name=index_name,
            dimension=dimension,
        ),
    )
    ctx.facts.append(f"index: {index_name} (pgvector, dense, {dimension}d)")
    return index_name, dimension


def bootstrap_setup(
    ctx: SeedContext,
    *,
    index_name: str,
    embedding_dimension: int,
    embedding_model: str | None = None,
    collection_name: str = "Sandbox Collection",
) -> None:
    """Apply the setup wizard's bootstrap: the hybrid pipeline pair + first collection."""
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
        "with the hybrid pipeline pair (dense + BM25, RRF-fused)"
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
    from app.services.ingestion_worker import run_document_ingestion

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
        ingested = ctx.session.get(models.Document, document_id)
        if ingested is None or ingested.status != models.DocumentStatus.READY:
            detail = ingested.error_message if ingested else "document row missing"
            raise SystemExit(f"Ingestion failed for {document_id}: {detail}")
        ctx.facts.append(f"document: {ingested.name} (ready, {ingested.num_chunks} chunks)")
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
    ctx.eval_dataset = dataset
    ctx.facts.append(
        f'eval dataset: "{name}" (ready, {dataset.num_queries} queries, '
        f"{dataset.num_corpus_docs} docs)"
    )
    ctx.links.append(("evals", "/evals"))
    ctx.links.append(("eval dataset", f"/evals/datasets/{dataset.id}"))


@dataclass(frozen=True)
class ImageCorpusPage:
    """One image corpus document and the text query written to find it."""

    external_id: str
    filename: str
    content_type: str
    title: str
    query_id: str
    query: str


#: The image corpus: a photograph plus three generated figure pages (a bar
#: chart, an orbit diagram, a process flow), each asked for by what it shows
#: rather than by words printed on it — a query that only works through OCR
#: measures the model's text rendering, not image retrieval.
IMAGE_CORPUS_PAGES: tuple[ImageCorpusPage, ...] = (
    ImageCorpusPage(
        external_id="galactic-center",
        filename="galactic-center.jpg",
        content_type="image/jpeg",
        title="Galactic centre composite",
        query_id="q1",
        query="a wide-field photograph of the centre of the Milky Way",
    ),
    ImageCorpusPage(
        external_id="sunspot-cycles",
        filename="sunspot-cycles-chart.png",
        content_type="image/png",
        title="Sunspot counts per solar cycle",
        query_id="q2",
        query="a bar chart of sunspot counts per solar cycle",
    ),
    ImageCorpusPage(
        external_id="aurora-orbit",
        filename="aurora-orbit-diagram.png",
        content_type="image/png",
        title="Aurora Station orbital path",
        query_id="q3",
        query="a diagram of nested orbits around a station",
    ),
    ImageCorpusPage(
        external_id="tidepool-consensus",
        filename="tidepool-consensus-flow.png",
        content_type="image/png",
        title="Tidepool consensus rounds",
        query_id="q4",
        query="a flow diagram of propose, vote, and commit steps",
    ),
)

#: The dataset's one image query: the photograph itself, asked as a picture.
#: Its gold document is the corpus page holding the same image, so retrieval
#: has a definite right answer and an image query that returns something else
#: is a real failure rather than a judgement call.
IMAGE_QUERY_ID = "q5"
IMAGE_QUERY_PAGE = IMAGE_CORPUS_PAGES[0]


def seed_image_eval_dataset(
    ctx: SeedContext, *, name: str = "Sandbox Image Eval Dataset"
) -> models.EvalDataset:
    """Persist a ready eval dataset whose corpus documents are images.

    Media is written through the app's own `DatasetMediaStore` and the triple
    is persisted through `EvalService.persist_triple` — the same two steps a
    benchmark download takes. The dataset row is minted here rather than by
    `upload_dataset` because the BEIR upload parser is text-only: an uploaded
    file carries no bytes for a page image, so a media dataset arriving
    offline has no parse step to go through.
    """
    from uuid import uuid4

    from app.db import models
    from app.db.repositories import EvalDatasetRepository
    from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
    from app.evals.datasets.media import DatasetMediaStore
    from app.evals.service import EvalService
    from app.schemas.enums import EvalDatasetSource, EvalDatasetStatus
    from app.utils.file_storage import FileStorage

    user = ctx.require_user()
    dataset_id = uuid4()
    store = DatasetMediaStore(FileStorage(), dataset_id)
    corpus: list[CorpusDoc] = []
    queries: list[QueryRecord] = []
    qrels: list[Qrel] = []
    for page in IMAGE_CORPUS_PAGES:
        media = store.write(
            "docs",
            page.external_id,
            content_type=page.content_type,
            data=(ASSETS_DIR / page.filename).read_bytes(),
        )
        # No text: the page image is the whole document, which is what makes
        # the run measure image retrieval and nothing else.
        corpus.append(
            CorpusDoc(external_doc_id=page.external_id, title=page.title, media=media)
        )
        queries.append(QueryRecord(external_query_id=page.query_id, text=page.query))
        qrels.append(Qrel(query_external_id=page.query_id, doc_external_id=page.external_id))

    query_media = store.write(
        "queries",
        IMAGE_QUERY_ID,
        content_type=IMAGE_QUERY_PAGE.content_type,
        data=(ASSETS_DIR / IMAGE_QUERY_PAGE.filename).read_bytes(),
    )
    queries.append(QueryRecord(external_query_id=IMAGE_QUERY_ID, media=query_media))
    qrels.append(
        Qrel(query_external_id=IMAGE_QUERY_ID, doc_external_id=IMAGE_QUERY_PAGE.external_id)
    )

    dataset = EvalDatasetRepository(ctx.session).add(
        models.EvalDataset(
            id=dataset_id,
            user_id=user.id,
            name=name,
            description="Seeded by the sandbox harness from local image assets.",
            source=EvalDatasetSource.CUSTOM_UPLOAD.value,
            status=EvalDatasetStatus.DOWNLOADING.value,
        )
    )
    dataset = EvalService(ctx.session).persist_triple(
        dataset,
        DatasetTriple(
            name=name,
            description=dataset.description,
            corpus=corpus,
            queries=queries,
            qrels=qrels,
        ),
    )
    ctx.facts.append(
        f'eval dataset: "{name}" (ready, {dataset.num_queries} queries — '
        f"{len(IMAGE_CORPUS_PAGES)} text and one image — over {dataset.num_corpus_docs} "
        f"image corpus documents; modalities {', '.join(dataset.modalities)})"
    )
    ctx.links.append(("evals", "/evals"))
    ctx.links.append(("image eval dataset", f"/evals/datasets/{dataset.id}"))
    return dataset


def seed_image_eval_run(
    ctx: SeedContext,
    *,
    dataset: models.EvalDataset,
    name: str = "Image corpus run",
) -> None:
    """Run the image dataset through the collection's own pipelines, to completion.

    Ingestion is the collection's bound pipeline (the multimodal one that reads
    image files) and retrieval its primary tool, so the run measures the graph
    the scenario already demonstrates rather than a pair chosen here. Running
    it during seeding also provisions the eval collection, so a run started
    from the UI afterwards reuses that corpus instead of re-ingesting it.
    """
    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.evals.execution.runner import EvalRunner
    from app.evals.service import EvalService
    from app.schemas.evals import EvalRunConfig, EvalRunCreate

    user = ctx.require_user()
    collection = ctx.require_collection()
    bindings = CollectionPipelineBindingRepository(ctx.session).list_for_collection(collection.id)
    ingest = next(b for b in bindings if b.role == models.BindingRole.INGEST)
    tool = next(b for b in bindings if b.role == models.BindingRole.TOOL)
    service = EvalService(ctx.session)
    run = service.create_run(
        user,
        EvalRunCreate(
            dataset_id=dataset.id,
            ingestion_pipeline_id=ingest.pipeline_id,
            retrieval_pipeline_id=tool.pipeline_id,
            name=name,
            config=EvalRunConfig(
                num_queries=dataset.num_queries,
                distractor_pool_size=0,
                seed=0,
                concurrency=1,
                k_values=[1, 5, 10],
                selected_metrics=[],
                run_inputs={},
            ),
        ),
    )
    EvalRunner(ctx.session).execute(run)
    ctx.session.refresh(run)
    ctx.facts.append(
        f'eval run "{name}" ({run.status}): {dataset.num_queries} queries scored against the '
        "ingested image corpus, the last of them an image query"
    )
    ctx.links.append(("image eval run", f"/evals/runs/{run.id}"))


def upload_unindexable_files(ctx: SeedContext, *, count: int = 3) -> None:
    """Upload files that genuinely fail to ingest, leaving them out of the index.

    Each file is declared `application/pdf` and holds bytes that are not a PDF,
    so the parse node's PDF handler cannot open the document and the failure it
    raises is what lands on the row — a real ingestion error, with no stub
    anywhere. `application/pdf` is auto-ingest eligible, so the upload yields a
    document and runs the pipeline the way any upload would.
    """
    import io

    from app.db import models
    from app.services.files import FileSystemService, UploadSpec
    from app.services.ingestion_worker import run_document_ingestion

    user = ctx.require_user()
    collection = ctx.require_collection()
    service = FileSystemService(ctx.session)
    document_ids = []
    for index in range(count):
        result = service.register_upload(
            user,
            collection,
            UploadSpec(filename=f"outage-{index + 1}.pdf", content_type="application/pdf"),
            io.BytesIO(b"this file claims to be a PDF and is not one"),
        )
        if result.document is None:
            raise SystemExit("An unindexable upload was not eligible for ingestion.")
        document_ids.append(result.document.id)

    for document_id in document_ids:
        run_document_ingestion(document_id)
        ctx.session.expire_all()
        document = ctx.session.get(models.Document, document_id)
        if document is None or document.status != models.DocumentStatus.FAILED:
            status = document.status if document else "missing"
            raise SystemExit(f"Expected {document_id} to fail ingestion, got {status}.")
    ctx.facts.append(
        f"{count} files failed to ingest (outage-1..{count}.pdf) — the Files page "
        "offers 'Retry failed files'"
    )


def upload_unsupported_image(ctx: SeedContext) -> None:
    """Force-ingest an image through a text-only pipeline.

    The upload records `unsupported` without a run; the force attempt then
    runs the whole graph, every parse node declines the file, and the run
    lands `unsupported` with all nodes completed — the state the trace
    renders with a Skipped parse node and the run-level reason banner.
    """
    from app.db import models
    from app.services.files import FileSystemService, UploadSpec
    from app.services.ingestion_worker import run_document_ingestion

    user = ctx.require_user()
    collection = ctx.require_collection()
    service = FileSystemService(ctx.session)
    asset = ASSETS_DIR / "aurora-orbit-diagram.png"
    with asset.open("rb") as handle:
        result = service.register_upload(
            user,
            collection,
            UploadSpec(filename=asset.name, content_type="image/png"),
            handle,
        )
    # The upload recorded `unsupported` without a run; resetting to pending is
    # the force-ingest path (`POST /api/files/{id}/ingest`) in service terms.
    document = service.ensure_pending_document(user, collection, result.file)
    ctx.session.commit()
    run_document_ingestion(document.id)
    ctx.session.expire_all()
    refreshed = ctx.session.get(models.Document, document.id)
    if refreshed is None or refreshed.status != models.DocumentStatus.UNSUPPORTED:
        status = refreshed.status if refreshed else "missing"
        raise SystemExit(f"Expected {document.id} to land unsupported, got {status}.")
    ctx.facts.append(
        "aurora-orbit-diagram.png force-ingested through the text-only pipeline "
        "(document unsupported; run unsupported with every node completed)"
    )
    ctx.links.append(("unsupported run trace", f"/traces/runs/{refreshed.ingestion_run_id}"))


def seed_eval_run_with_unindexed_corpus_doc(
    ctx: SeedContext, *, name: str = "Corpus with a failed document"
) -> None:
    """Run an eval whose corpus holds one document that cannot be indexed.

    The third corpus document carries only whitespace, so it chunks to nothing
    and never reaches the index — the state the corpus retry path exists to
    repair. Everything else about the run is ordinary, so the run page shows a
    genuine unscored query beside two scored ones.
    """

    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.evals.execution.runner import EvalRunner
    from app.evals.service import EvalService
    from app.schemas.evals import EvalRunConfig, EvalRunCreate

    user = ctx.require_user()
    collection = ctx.require_collection()
    corpus, queries, qrels = _corpus_with_one_empty_document()
    service = EvalService(ctx.session)
    dataset = service.upload_dataset(
        user,
        name=name,
        corpus=corpus,
        queries=queries,
        qrels=qrels,
        description="One corpus document carries no text and cannot be indexed.",
    )
    bindings = CollectionPipelineBindingRepository(ctx.session).list_for_collection(collection.id)
    ingest = next(b for b in bindings if b.role == models.BindingRole.INGEST)
    tool = next(b for b in bindings if b.role == models.BindingRole.TOOL)
    run = service.create_run(
        user,
        EvalRunCreate(
            dataset_id=dataset.id,
            ingestion_pipeline_id=ingest.pipeline_id,
            retrieval_pipeline_id=tool.pipeline_id,
            name=name,
            config=EvalRunConfig(
                num_queries=3,
                distractor_pool_size=0,
                seed=0,
                concurrency=1,
                k_values=[1, 5, 10],
                selected_metrics=[],
                run_inputs={},
            ),
        ),
    )
    EvalRunner(ctx.session).execute(run)
    ctx.session.refresh(run)
    ctx.facts.append(
        f'eval run "{name}" (completed): 1 of 3 corpus documents never reached the index, '
        "so its query is recorded unscored and the corpus retry action is offered"
    )
    ctx.links.append(("eval run (corpus gap)", f"/evals/runs/{run.id}"))
    ctx.links.append(("eval dataset (corpus gap)", f"/evals/datasets/{dataset.id}"))


def _corpus_with_one_empty_document() -> tuple[str, str, str]:
    """BEIR-format corpus/queries/qrels where the third document has no text."""
    import json

    documents = [
        ("aurora", "Aurora Station", "Aurora Station is a research outpost in low orbit."),
        ("tidepool", "Tidepool Protocol", "The Tidepool Protocol governs sensor telemetry."),
        ("glasswing", "", "   "),
    ]
    questions = [
        "what is Aurora Station",
        "what does the Tidepool Protocol govern",
        "what is in the Glasswing archive",
    ]
    corpus = "\n".join(
        json.dumps({"_id": doc_id, "title": title, "text": text})
        for doc_id, title, text in documents
    )
    queries = "\n".join(
        json.dumps({"_id": f"q{index}", "text": text})
        for index, text in enumerate(questions, start=1)
    )
    qrels = "\n".join(
        f"q{index}\t{doc_id}\t1"
        for index, (doc_id, _, _) in enumerate(documents, start=1)
    )
    return corpus, queries, qrels


def repoint_retrieval_embedding(ctx: SeedContext, *, embedding_model: str) -> None:
    """Bind the collection to a search tool using a *different* embedding model.

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


def _copy_template_pipelines(ctx: SeedContext, *, index_name: str) -> dict[str, UUID]:
    """Copy every template pipeline, repointed at `index_name`.

    Returns the copies by the template slug they came from. Each copy's store
    nodes name the second collection's indexes (dense, or the `-bm25` sibling
    for a lexical node), and its query-input node declares its own tool name —
    a copy that keeps the original's tool identity cannot be bound beside it in
    one collection.
    """
    from app.pipelines.index_identity import is_lexical_node, store_bound_node
    from app.pipelines.nodes.io import RetrievalInputNode
    from app.pipelines.registry import default_registry
    from app.services.index_scaffolding import register_definition_indexes
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
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
            if node.type == RetrievalInputNode.type:
                config["tool_name"] = COPIED_TOOL_NAME
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
    return copies


def add_alternate_search_pipeline(
    ctx: SeedContext,
    *,
    name: str = "Dense-Only Retrieval",
) -> models.Pipeline:
    """Copy the wizard's search tool verbatim, then drop its BM25 branch.

    Verbatim means the copy keeps the original's `search` tool name — which is
    what any copy has until someone edits it, and the reason switching a
    collection's search pipeline has to unbind the outgoing one first. Dropping
    the lexical branch leaves a graph the trace tells apart from the default's
    at a glance, so "which pipeline actually ran?" is answerable from the UI.

    Left unbound: this is a pipeline the user is about to switch to.
    """
    from app.pipelines.index_identity import is_lexical_node
    from app.services.pipeline_scaffolds import DEFAULT_SEARCH_SLUG
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
    pipelines = PipelineService(ctx.session)
    original = pipelines.get_by_template_slug(user.id, DEFAULT_SEARCH_SLUG)
    if original is None:
        raise SystemExit("No scaffolded search tool to copy.")

    copy = pipelines.copy_pipeline(user, original, name=name)
    ctx.session.flush()
    definition = pipelines.get_definition(copy)
    dropped = {
        node.id
        for node in definition.nodes
        if is_lexical_node(node.type) or node.type.startswith("fusion.")
    }
    if not dropped:
        raise SystemExit("The scaffolded search tool has no lexical branch to drop.")
    # The dense branch takes over whatever the fusion node fed.
    downstream = next(
        edge.target
        for edge in definition.edges
        if edge.source in dropped and edge.target not in dropped
    )
    dense = next(
        edge.source
        for edge in definition.edges
        if edge.target in dropped and edge.source not in dropped and edge.source != "query-input"
    )
    kept = [edge for edge in definition.edges if not ({edge.source, edge.target} & dropped)]
    dense_only = definition.model_copy(
        update={
            "nodes": [node for node in definition.nodes if node.id not in dropped],
            "edges": [
                *kept,
                kept[0].model_copy(
                    update={"id": "edge-dense-downstream", "source": dense, "target": downstream}
                ),
            ],
        }
    )
    pipelines.update_pipeline(
        pipeline=copy,
        definition=dense_only,
        change_summary="Drop the lexical branch — dense retrieval only.",
        actor_id=user.id,
    )
    ctx.session.commit()
    ctx.facts.append(
        f'search tool: "{name}" ({len(dense_only.nodes)} nodes, tool name '
        "'search', unbound) — a verbatim copy of the default with its BM25 branch removed"
    )
    ctx.links.append(("alternate search tool", f"/pipelines/tools?pipeline={copy.id}"))
    return copy


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

    The retrieval copy is also given its own `tool_name`. A verbatim copy
    keeps the original's tool identity, and two pipelines exposing one base
    name cannot be bound to the same collection — so without this the two
    pipelines in this state can never both be tools, which is the
    first thing a tool-binding surface is exercised against.
    """
    from app.schemas.collections import CollectionCreate
    from app.schemas.enums import IndexBackend
    from app.schemas.indexes import IndexCreateRequest
    from app.services.collections import CollectionService
    from app.services.index_admin import IndexAdminService
    from app.services.pipeline_scaffolds import DEFAULT_INGEST_SLUG

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

    # Both planes, because the scaffolded pipelines are hybrid: pointing a BM25
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

    copies = _copy_template_pipelines(ctx, index_name=index_name)

    # Bound to the copies from the start: a collection is created with the
    # pipelines it runs, so this state never passes through one sharing the
    # first collection's graphs.
    second = CollectionService(ctx.session).create(
        user,
        CollectionCreate(
            name=name,
            description="Runs copies of the first collection's pipelines.",
            ingest_pipeline_id=copies[DEFAULT_INGEST_SLUG],
            tool_pipeline_ids=[
                pipeline_id
                for slug, pipeline_id in copies.items()
                if slug != DEFAULT_INGEST_SLUG
            ],
        ),
    )
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
    from app.services.ingestion_worker import run_document_ingestion

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
        "app.services.ingestion_worker.schedule_insight_refresh", return_value=False
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


def bind_multimodal_ingestion(
    ctx: SeedContext,
    *,
    index_name: str,
    dimension: int,
    vision_model: str | None = None,
) -> None:
    """Replace the collection's ingestion binding with the multimodal graph.

    The shipped defaults are text-only, so a collection that ingests images
    is a pipeline a user built — this seeds exactly that, through
    `PipelineService` like the editor would.
    """
    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.services.pipelines import PipelineService
    from sandbox.multimodal_pipeline import build_multimodal_ingestion_pipeline

    user = ctx.require_user()
    connection = ctx.require_connection()
    collection = ctx.require_collection()
    model = vision_model or config.default_chat_model()
    pipeline = PipelineService(ctx.session).create_pipeline(
        user=user,
        name="Multimodal ingestion",
        description=(
            "Text, embedded figures, and uploaded images parsed in parallel, merged "
            "into one describe/embed/index chain."
        ),
        definition=build_multimodal_ingestion_pipeline(
            embedding_connection_id=connection.id,
            embedding_model=config.default_embedding_model(),
            chat_connection_id=connection.id,
            vision_model=model,
            index_name=index_name,
            dimension=dimension,
        ),
        change_summary="Multimodal ingestion for the sandbox scenario.",
    )
    ctx.session.flush()
    bindings = CollectionPipelineBindingRepository(ctx.session)
    for binding in bindings.list_for_collection(
        collection.id, role=models.BindingRole.INGEST
    ):
        ctx.session.delete(binding)
    ctx.session.flush()
    bindings.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.INGEST,
            is_primary=True,
        )
    )
    ctx.session.commit()
    ctx.facts.append(
        f'pipeline: "Multimodal ingestion" (id {pipeline.id}) bound as the collection\'s '
        f"ingestion pipeline — vision model {model}"
    )
    # The editor selects a pipeline from `?pipeline=`, on the kind route —
    # a bare `/pipelines/<id>` is an unknown kind and lands on the default.
    ctx.links.append(("multimodal pipeline", f"/pipelines/ingestion?pipeline={pipeline.id}"))


def bind_shared_space_ingestion(
    ctx: SeedContext,
    *,
    index_name: str,
    dimension: int,
    embedding_model: str,
) -> None:
    """Bind an ingestion pipeline that embeds text and images into one space."""
    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.services.pipelines import PipelineService
    from sandbox.multimodal_pipeline import build_shared_space_ingestion_pipeline

    user = ctx.require_user()
    connection = ctx.require_connection()
    collection = ctx.require_collection()
    pipeline = PipelineService(ctx.session).create_pipeline(
        user=user,
        name="Multimodal embedding",
        description=(
            "Text and images embedded by one image-capable model into one index."
        ),
        definition=build_shared_space_ingestion_pipeline(
            embedding_connection_id=connection.id,
            embedding_model=embedding_model,
            index_name=index_name,
            dimension=dimension,
        ),
        change_summary="Shared text/image vector space for the sandbox scenario.",
    )
    ctx.session.flush()
    bindings = CollectionPipelineBindingRepository(ctx.session)
    for binding in bindings.list_for_collection(collection.id, role=models.BindingRole.INGEST):
        ctx.session.delete(binding)
    ctx.session.flush()
    bindings.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.INGEST,
            is_primary=True,
        )
    )
    ctx.session.commit()
    ctx.facts.append(
        f'pipeline: "Multimodal embedding" (id {pipeline.id}) bound as the collection\'s '
        f"ingestion pipeline — {embedding_model} embeds text and images alike"
    )
    ctx.links.append(("multimodal pipeline", f"/pipelines/ingestion?pipeline={pipeline.id}"))


def ingest_media(ctx: SeedContext, *, files: tuple[tuple[str, str], ...]) -> list[UUID]:
    """Upload `(filename, content_type)` assets and run real ingestion on each."""
    from app.db import models
    from app.services.files import FileSystemService, UploadSpec
    from app.services.ingestion_worker import run_document_ingestion

    user = ctx.require_user()
    collection = ctx.require_collection()
    service = FileSystemService(ctx.session)
    document_ids: list[UUID] = []
    for filename, content_type in files:
        with (ASSETS_DIR / filename).open("rb") as stream:
            result = service.register_upload(
                user, collection, UploadSpec(filename=filename, content_type=content_type), stream
            )
        # A document row exists for every auto-ingestable type; a scenario
        # binding a pipeline that reads none of a file's formats records it
        # unsupported instead, so the fallback covers that too.
        document = result.document or service.ensure_pending_document(
            user, collection, result.file
        )
        document_ids.append(document.id)
    ctx.session.commit()

    for document_id in document_ids:
        run_document_ingestion(document_id)
        ctx.session.expire_all()
        ingested = ctx.session.get(models.Document, document_id)
        if ingested is None or ingested.status != models.DocumentStatus.READY:
            detail = ingested.error_message if ingested else "document row missing"
            raise SystemExit(f"Ingestion failed for {document_id}: {detail}")
        ctx.facts.append(f"document: {ingested.name} (ready, {ingested.num_chunks} chunks)")
    return document_ids


#: A model id no provider serves. The call fails on every retry with a real
#: provider error, which is the same class of failure as the 429 that the
#: degraded status exists to make visible — and it fails deterministically,
#: unlike a rate limit nobody can schedule.
UNSERVED_MODEL = "openai/gpt-does-not-exist"


def degrade_retrieval_with_llm_node(ctx: SeedContext) -> None:
    """Put a HyDE generator that can never succeed into the search tool.

    The generator passes its input through, so every query still returns
    results — the shape that made a failed step invisible. Its node run, the
    pipeline run, and any eval run over it are all recorded degraded.
    """
    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.pipelines.definition import PipelineEdgeDefinition, PipelineNodeDefinition
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
    connection = ctx.require_connection()
    collection = ctx.require_collection()
    pipelines = PipelineService(ctx.session)
    bindings = CollectionPipelineBindingRepository(ctx.session)
    tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
    primary = next((b for b in tools if b.is_primary), tools[0])
    pipeline = pipelines.get_pipeline(primary.pipeline_id, user.id)
    if pipeline is None:
        raise RuntimeError("The collection's primary search pipeline is missing.")
    definition = pipelines.get_definition(pipeline)
    hyde = PipelineNodeDefinition(
        id="hyde",
        type="llm.generate",
        name="HyDE",
        position={"x": 40.0, "y": 260.0},
        config={
            "connection_id": str(connection.id),
            "model_name": UNSERVED_MODEL,
            "prompt": "Write a short hypothetical passage answering: {{text}}",
            "output_fields": [
                {"name": "passages", "type": "string_list", "target": {"kind": "items"}}
            ],
        },
    )
    edges = [
        edge.model_copy(update={"source": hyde.id}) if edge.source == "query-input" else edge
        for edge in definition.edges
    ]
    edges.append(
        PipelineEdgeDefinition(
            id="edge-hyde",
            source="query-input",
            target=hyde.id,
            source_port="items",
            target_port="items",
        )
    )
    pipelines.update_pipeline(
        pipeline=pipeline,
        definition=definition.model_copy(update={"nodes": [*definition.nodes, hyde], "edges": edges}),
        change_summary="HyDE generator whose model no provider serves.",
        actor_id=user.id,
    )
    ctx.session.commit()
    ctx.facts.append(
        "search tool carries a HyDE generator on a model no provider serves — "
        "every query degrades on that node and passes the original query through"
    )
    ctx.links.append(("search tool (HyDE)", f"/pipelines/tools?pipeline={pipeline.id}"))


def _score_eval_run(
    ctx: SeedContext, *, name: str, retrieval_pipeline_id: UUID | None = None
) -> models.EvalRun:
    """Run the seeded dataset through a search tool and return the finished run.

    `retrieval_pipeline_id` defaults to the collection's bound tool; pass one to
    score the same dataset through a different pipeline.
    """
    from app.db import models
    from app.db.repositories import CollectionPipelineBindingRepository
    from app.evals.execution.runner import EvalRunner
    from app.evals.service import EvalService
    from app.schemas.evals import EvalRunConfig, EvalRunCreate

    user = ctx.require_user()
    collection = ctx.require_collection()
    dataset = ctx.require_eval_dataset()
    bindings = CollectionPipelineBindingRepository(ctx.session).list_for_collection(collection.id)
    ingest = next(b for b in bindings if b.role == models.BindingRole.INGEST)
    tool = next(b for b in bindings if b.role == models.BindingRole.TOOL)
    run = EvalService(ctx.session).create_run(
        user,
        EvalRunCreate(
            dataset_id=dataset.id,
            ingestion_pipeline_id=ingest.pipeline_id,
            retrieval_pipeline_id=retrieval_pipeline_id or tool.pipeline_id,
            name=name,
            config=EvalRunConfig(
                num_queries=3,
                distractor_pool_size=0,
                seed=0,
                concurrency=1,
                k_values=[1, 5, 10],
                selected_metrics=[],
                run_inputs={},
            ),
        ),
    )
    EvalRunner(ctx.session).execute(run)
    ctx.session.refresh(run)
    return run


def seed_degraded_eval_run(ctx: SeedContext, *, name: str = "Degraded HyDE run") -> None:
    """Score the seeded dataset through the degraded search tool.

    Every query returns results and carries real metrics, so the run completes
    with a full aggregate — and is flagged degraded, which is the whole point:
    those numbers describe a pipeline that only partly ran.
    """
    run = _score_eval_run(ctx, name=name)
    ctx.facts.append(
        f'eval run "{name}" (completed, {run.degraded_count} degraded queries): every query '
        "scored, all of them through a pipeline whose HyDE step never executed"
    )
    ctx.links.append(("eval run (degraded)", f"/evals/runs/{run.id}"))


def seed_comparable_eval_runs(
    ctx: SeedContext,
    alternate_pipeline_id: UUID,
    *,
    baseline_name: str = "Hybrid baseline",
    variant_name: str = "Dense-only variant",
) -> None:
    """Score the dataset twice — once per search tool — and link the diff.

    Two runs differing in exactly one thing is the state the comparison view
    reads: same dataset, same corpus, same sample, one search tool each.
    """
    baseline = _score_eval_run(ctx, name=baseline_name)
    variant = _score_eval_run(
        ctx, name=variant_name, retrieval_pipeline_id=alternate_pipeline_id
    )
    for run, tool in ((baseline, "the bound hybrid search tool"), (variant, "the dense-only copy")):
        ctx.facts.append(f'eval run "{run.name}" (completed): 3 queries scored through {tool}')
    ctx.links.append(("eval run (hybrid)", f"/evals/runs/{baseline.id}"))
    ctx.links.append(("eval run (dense-only)", f"/evals/runs/{variant.id}"))
    ctx.links.append(("eval comparison", f"/evals/compare?a={baseline.id}&b={variant.id}"))


#: A long, sectioned technical report. Every other sample document fits in one
#: chunk, so this is the corpus any chunk-adjacency feature needs: a document
#: whose chunks have neighbours to expand into.
LONG_DOCUMENT = "meridian-survey.md"


def narrow_ingestion_chunks(
    ctx: SeedContext, *, chunk_size: int = 160, chunk_overlap: int = 20
) -> None:
    """Shrink the scaffolded ingestion pipeline's chunk window.

    Small chunks are the premise of context expansion, not a trick to inflate a
    chunk count: they embed precisely, which is what makes retrieval accurate,
    and they are too narrow to answer from, which is what the Expand Context
    node exists to fix. Set before the long document is ingested so its chunks
    are produced at this size.
    """
    from app.services.pipeline_scaffolds import DEFAULT_INGEST_SLUG
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
    pipelines = PipelineService(ctx.session)
    pipeline = pipelines.get_by_template_slug(user.id, DEFAULT_INGEST_SLUG)
    if pipeline is None:
        raise SystemExit("No scaffolded ingestion pipeline to narrow.")
    definition = pipelines.get_definition(pipeline)
    nodes = [
        node.model_copy(
            update={
                "config": {
                    **(node.config or {}),
                    "chunk_size": chunk_size,
                    "chunk_overlap": chunk_overlap,
                }
            }
        )
        if node.type.startswith("chunker.")
        else node
        for node in definition.nodes
    ]
    pipelines.update_pipeline(
        pipeline=pipeline,
        definition=definition.model_copy(update={"nodes": nodes}),
        change_summary=f"Chunk at {chunk_size} tokens for context-expansion testing.",
        actor_id=user.id,
    )
    ctx.session.commit()
    ctx.facts.append(
        f"ingestion pipeline chunks at {chunk_size} tokens (+{chunk_overlap} overlap) — "
        "small enough that a single chunk is too narrow to answer from"
    )


def add_context_expansion_pipeline(
    ctx: SeedContext,
    *,
    name: str = "Expanded Context Retrieval",
) -> None:
    """Copy the wizard's search tool and expand each match to its neighbours.

    Wired between the retriever and Result Limit, which is where expansion
    belongs: it runs on the ranked matches, and the limit then counts expanded
    items rather than the chunks they were built from.
    """
    from app.pipelines.nodes.expansion import ExpandContextNode
    from app.services.pipeline_scaffolds import DEFAULT_SEARCH_SLUG
    from app.services.pipelines import PipelineService

    user = ctx.require_user()
    pipelines = PipelineService(ctx.session)
    original = pipelines.get_by_template_slug(user.id, DEFAULT_SEARCH_SLUG)
    if original is None:
        raise SystemExit("No scaffolded search tool to copy.")
    copy = pipelines.copy_pipeline(user, original, name=name)
    ctx.session.flush()
    definition = pipelines.get_definition(copy)

    # The expansion node reads the same index the dense retriever queried, so
    # its store identity is copied from that node rather than re-derived.
    dense = next(
        (
            node
            for node in definition.nodes
            if node.type.startswith("retriever.") and not node.type.endswith("bm25")
        ),
        None,
    )
    if dense is None:
        raise SystemExit("The scaffolded search tool has no dense retriever.")
    limit = next(node for node in definition.nodes if node.type.startswith("limit."))
    config = dict(dense.config or {})
    expand = definition.nodes[0].model_copy(
        update={
            "id": "expand-context",
            "name": "Expand Context",
            "type": ExpandContextNode.type,
            "config": {
                "backend": config.get("backend", "pgvector"),
                "index_name": config.get("index_name", ""),
                "namespace": config.get("namespace", ""),
                "mode": "window",
                "window": 2,
            },
            "ui": {},
        }
    )
    into_limit = [edge for edge in definition.edges if edge.target == limit.id]
    rest = [edge for edge in definition.edges if edge.target != limit.id]
    edges = [
        *rest,
        *[
            edge.model_copy(update={"id": f"edge-{edge.source}-expand", "target": expand.id})
            for edge in into_limit
        ],
        into_limit[0].model_copy(
            update={"id": "edge-expand-limit", "source": expand.id, "target": limit.id}
        ),
    ]
    pipelines.update_pipeline(
        pipeline=copy,
        definition=definition.model_copy(
            update={"nodes": [*definition.nodes, expand], "edges": edges}
        ),
        change_summary="Expand each match to its neighbouring chunks.",
        actor_id=user.id,
    )
    ctx.session.commit()
    ctx.facts.append(
        f'search tool: "{name}" (unbound) — the default plus an Expand '
        "Context node in window mode, ±2 chunks"
    )
    ctx.links.append(("context-expansion pipeline", f"/pipelines/tools?pipeline={copy.id}"))
