# TransparentRAG

TransparentRAG is a user-centric Retrieval-Augmented Generation stack that keeps every step — parsing, chunking, embedding, indexing, and chatting — observable. The backend is a FastAPI service backed by SQLModel+SQLite, Pinecone for vector search, and OpenRouter for embeddings/LLM inference. The frontend is a Next.js + shadcn/ui control room that lets users manage collections, inspect chunks, run ad-hoc queries, and chat with full visibility into tool calls and token usage.

---

## Features

- **User workspaces** with JWT auth and a normalized schema (users, collections, documents, chunks, chat sessions/messages, ingestion/query events).
- **Configurable chunking** (token, sentence, paragraph, semantic) with adjustable size & overlap. Defaults automatically match the embedding model’s context length.
- **OpenRouter-native embeddings & chat**, including live model catalog browsing and tool calling (`pinecone_query`) during multi-turn conversations.
- **Pinecone orchestration** that persists every chunk + embedding locally for auditability while upserting to the configured namespace/index.
- **Transparent telemetry**: tool traces, provider info, token usage, and context consumption are stored with every chat turn.
- **Next.js dashboard** (shadcn/ui) for registration/login, collection provisioning, document uploads (PDF + text), query inspection, and chatbot sessions.

---

## Backend Setup (FastAPI)

### 1. Environment

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Create an `.env.local` (or `.env`) with the required credentials:

```ini
# OpenRouter
OPENROUTER_API_KEY=...
OPENROUTER_SITE_URL=https://transparent-rag.local
OPENROUTER_SITE_NAME=TransparentRAG
OPENROUTER_DEFAULT_EMBEDDING_MODEL=qwen/qwen3-embedding-0.6b
OPENROUTER_DEFAULT_CHAT_MODEL=openai/gpt-oss-120b

# Pinecone
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=transparent-rag
PINECONE_REGION=us-east-1
PINECONE_CLOUD=aws

# Auth / DB
JWT_SECRET_KEY=super-secret-string
DATABASE_URL=sqlite:///transparent_rag.db
FILE_STORAGE_PATH=./storage
```

### 2. Run the API

```bash
uvicorn app.api.main:app --reload
```

The startup hook creates/updates the local SQLite schema (`transparent_rag.db`). The primary endpoints are:

| Route | Description |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/token`, `GET /api/auth/me` | User onboarding + JWT tokens |
| `GET /api/models` | Cached OpenRouter model catalog |
| `GET/POST/PATCH /api/collections` | Collection CRUD with chunk/embedding settings |
| `POST /api/collections/{id}/documents` | Upload PDF/text, parse → chunk → embed → Pinecone |
| `GET /api/documents/{id}/chunks` | Chunk lineage & embeddings |
| `POST /api/collections/{id}/query` | Transparent Pinecone similarity search |
| `POST /api/collections/{id}/chat` | Multi-turn LLM chat with tool calling + telemetry |

### 3. Database overview

- **users**: identity + hashed passwords (bcrypt via Passlib).
- **collections**: per-user RAG configuration (models, chunk settings, Pinecone namespace, context windows, embedding dimension metadata).
- **documents & document_chunks**: ingestion audit trail with chunk text, embeddings, strategy, overlap, and metadata.
- **chat_sessions & chat_messages**: full conversation history, tool outputs, reasoning traces, and token usage.
- **query_events / ingestion_events**: structured logs for observability.

All writes go through SQLModel repositories so the physical store (SQLite now) can be swapped later.

### 4. Running tests

```bash
pytest
```

Existing tests cover the Pinecone retriever; add more as new modules evolve.



## Development Notes

- **Chunking strategies** live in `app/services/chunking.py` and implement token, sentence, paragraph, and semantic heuristics with overlap validation.
- **OpenRouter client** (`app/services/openrouter.py`) centralizes model catalog caching, embedding calls, and chat completion requests with optional tool specs.
- **Ingestion service** (`app/services/ingestion.py`) persists uploads to `FILE_STORAGE_PATH`, parses documents, chunks + embeds through OpenRouter, upserts to Pinecone, and writes every chunk/embedding to SQL for auditability.
- **Chat service** (`app/services/chat.py`) handles multi-turn orchestration, Pinecone tool calling, reasoning capture, and usage aggregation before persisting back to the database.

---

