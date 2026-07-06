"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    auth,
    chat,
    collections,
    documents,
    health,
    indexes,
    models,
    pipelines,
    search,
    traces,
    visualizations,
)
from app.core.config import get_settings
from app.db.bootstrap import init_db
from app.db.engine import session_scope
from app.services.pipelines import backfill_default_pipelines

settings = get_settings()


def configure_logging(log_level_name: str) -> None:
    """Configure root/uvicorn loggers from a level name; no-op when blank.

    Called at startup (from `lifespan`) rather than at import time, so tests
    can exercise it directly instead of reloading this module.
    """
    log_level_name = log_level_name.strip().upper()
    if not log_level_name:
        return
    log_level = getattr(logging, log_level_name, logging.INFO)
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        force=True,
    )
    logging.getLogger().setLevel(log_level)
    logging.getLogger("uvicorn").setLevel(log_level)
    logging.getLogger("uvicorn.access").setLevel(log_level)
    logging.getLogger("uvicorn.error").setLevel(log_level)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize application resources on startup."""
    configure_logging(settings.log_level or "")
    init_db()
    with session_scope() as session:
        backfill_default_pipelines(session)
    yield


app = FastAPI(
    title="TransparentRAG API",
    version="0.2.0",
    description="User-centric RAG backend on FastAPI + Pinecone + OpenRouter.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(models.router)
app.include_router(pipelines.router)
app.include_router(indexes.router)
app.include_router(collections.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(traces.router)
app.include_router(chat.router)
app.include_router(visualizations.router)
