"""FastAPI application entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    admin,
    auth,
    chat,
    collections,
    config,
    connections,
    diagnostics,
    documents,
    evals,
    files,
    health,
    indexes,
    models,
    pipelines,
    search,
    setup,
    tokenizers,
    tools,
    traces,
    visualizations,
)
from app.core.config import get_settings
from app.db.bootstrap import init_db
from app.db.engine import session_scope
from app.observability import (
    RequestContextMiddleware,
    configure_logging,
    get_logger,
)
from app.observability import events as log_events
from app.providers.registry import close_provider_clients
from app.services.accounts import ensure_admin_exists
from app.services.app_config import get_app_config
from app.services.binding_migration import migrate_pipeline_bindings
from app.services.file_backfill import backfill_file_nodes
from app.services.ingestion_queue import ingestion_queue
from app.services.pipelines import (
    backfill_default_pipelines,
    upgrade_stored_pipeline_definitions,
)
from app.services.provider_migration import migrate_provider_connections
from app.services.tokenizer_migration import migrate_tokenizer_nodes
from app.telemetry import purge_expired as purge_expired_telemetry

settings = get_settings()
logger = get_logger("app.lifespan")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize application resources on startup."""
    configure_logging(settings.log_level, debug=settings.debug)
    init_db()
    logger.info(log_events.DB_BOOTSTRAP_COMPLETED)
    with session_scope() as session:
        migrate_provider_connections(session)
        migrate_pipeline_bindings(session)
        migrate_tokenizer_nodes(session)
        upgrade_stored_pipeline_definitions(session)
        backfill_default_pipelines(session)
        backfill_file_nodes(session)
        ensure_admin_exists(session)
    purge_expired_telemetry()
    ingestion_queue.start(get_app_config().uploads.ingestion_concurrency)
    ingestion_queue.recover()
    logger.info(log_events.APP_STARTUP_COMPLETED)
    try:
        yield
    finally:
        ingestion_queue.stop()
        close_provider_clients()
        logger.info(log_events.APP_SHUTDOWN_COMPLETED)


app = FastAPI(
    title="Ragworks API",
    version="0.2.0",
    description="User-centric RAG backend on FastAPI + pgvector/Pinecone + OpenRouter.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
# Outermost application middleware: binds the correlation ID before any route
# runs and logs the request outcome after. Added last so it wraps CORS too.
app.add_middleware(RequestContextMiddleware)

app.include_router(health.router)
app.include_router(config.router)
app.include_router(auth.router)
app.include_router(connections.router)
app.include_router(admin.router)
app.include_router(models.router)
app.include_router(pipelines.router)
app.include_router(indexes.router)
app.include_router(collections.router)
app.include_router(diagnostics.router)
app.include_router(documents.router)
app.include_router(evals.router)
app.include_router(files.router)
app.include_router(search.router)
app.include_router(setup.router)
app.include_router(tools.router)
app.include_router(traces.router)
app.include_router(tokenizers.router)
app.include_router(chat.router)
app.include_router(visualizations.router)
