from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.config import get_settings
from app.api.routes import auth, chat, collections, documents, health, models, search
from app.db.session import init_db

settings = get_settings()
log_level_name = (settings.log_level or "").strip().upper()
if log_level_name:
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
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="TransparentRAG API",
    version="0.2.0",
    description="User-centric RAG backend on FastAPI + Pinecone + OpenRouter.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(models.router)
app.include_router(collections.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)
