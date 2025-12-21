# TransparentRAG

TransparentRAG is a user-centric Retrieval-Augmented Generation stack that keeps every step — parsing, chunking, embedding, indexing, and chatting — observable. The backend is a FastAPI service backed by SQLModel+Postgres, Pinecone for vector search, and OpenRouter for embeddings/LLM inference. The frontend is a Next.js + shadcn/ui control room that lets users manage collections, inspect chunks, run ad-hoc queries, and chat with full visibility into tool calls and token usage.

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
uv sync --locked
# or: make env
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
DATABASE_URL=postgresql+psycopg://localhost:5432/transparentrag
FILE_STORAGE_PATH=./storage
```

### 2. Run the API

```bash
make server
# or: uv run uvicorn app.api.main:app --reload
```

`make server` ensures Postgres is running (set `POSTGRES_DATA_DIR` or `POSTGRES_START_COMMAND` if needed). The startup hook initializes the Postgres schema if it is missing. The primary endpoints are:

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

All writes go through SQLModel repositories so the physical store remains configurable via `DATABASE_URL`.

### 4. Running tests

```bash
pytest
```

Existing tests cover the Pinecone retriever; add more as new modules evolve.


## Frontend Console (Next.js)

The `/frontend` directory contains the TransparentRAG operator console built with Next.js 16 (App Router) and Tailwind CSS 4.

### 1. Install + run

```bash
cd frontend
npm install
# Point the UI at your FastAPI host (defaults to http://127.0.0.1:8000)
export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8000"
npm run dev
```

Or from the repo root:

```bash
make frontend
```

### 2. What you get

- **Auth funnel** – marketing-style login page plus a register/sign-in screen wired to `/api/auth`.
- **Dashboard** – live metrics for collections, documents, sessions, and context usage.
- **Collections workspace** – create collections, upload documents, inspect chunks, and run transparent similarity queries against `/api/collections/{id}/query`.
- **Chat studio** – pick a collection, browse chat sessions, send new turns (with tool traces + usage telemetry), and monitor context consumption.

All API calls go through `NEXT_PUBLIC_API_BASE_URL` so you can point the UI at local, staging, or production FastAPI hosts without rebuilding.



## Development Notes

- **Chunking strategies** live in `app/services/chunking.py` and implement token, sentence, paragraph, and semantic heuristics with overlap validation.
- **OpenRouter client** (`app/services/openrouter.py`) centralizes model catalog caching, embedding calls, and chat completion requests with optional tool specs.
- **Ingestion service** (`app/services/ingestion.py`) persists uploads to `FILE_STORAGE_PATH`, parses documents, chunks + embeds through OpenRouter, upserts to Pinecone, and writes every chunk/embedding to SQL for auditability.
- **Chat service** (`app/services/chat.py`) handles multi-turn orchestration, Pinecone tool calling, reasoning capture, and usage aggregation before persisting back to the database.

---



## Project requirements — User-based RAG chat platform (OpenRouter + Pinecone)

⸻

## High level summary
	•	Build a user-centered RAG chat app:
	•	Backend: Python / FastAPI
	•	Frontend: Next.js (use shadcn/ui components)
	•	Vector store: Pinecone
	•	Model/Embeddings/Inference: OpenRouter unified API (allow swapping model strings)
	•	Authentication & per-user data isolation (multi-tenant)
	•	Fully transparent: expose model metadata, context usage, tool calls, chunking transforms, and store everything in DB

⸻

# Core functional requirements

## User & auth
	•	User registration / login (email + password) and session management.
	•	JWT-based API auth (refresh tokens optional) for SPA.
	•	Per-user isolation: each user’s collections, indexes, chats and data are private by default.

## Collections & documents
	•	Users can create multiple collections.
	•	Collection metadata:
	•	name, description (user-entered, used as additional system context), creation time, owner, visibility (private/public optional).
	•	Document ingestion types supported at MVP: plain text, PDF.
	•	UI to upload documents and set collection-level defaults before ingestion.

## Chunking & embedding options (per-collection and/or per-ingest)
	•	Chunking strategies (user-selectable):
	•	fixed token size, fixed character size
	•	sentence-level
	•	semantic/paragraph-level (heuristics)
	•	configurable chunk overlap (characters/tokens)
	•	custom chunker (regex / paragraph breaks)
	•	Controls exposed to user:
	•	chunk size, chunk overlap, chunk strategy
	•	whether to preserve original document offsets and chunk mapping
	•	whether to store full chunk text and original page/position
	•	Default chunk size is determined by the embedding model’s max sequence length (pull via OpenRouter models API).
	•	After chunking, show a preview and let user confirm before embedding/upsert.

## Emddings & Pinecone
	•	Integrate with OpenRouter embeddings API by default (example default model string: qwen/qwen3-embedding-0.6b — but must be configurable).
	•	Allow user to select embedding model string from the OpenRouter Models API (browse models endpoint).
	•	Vector store design:
	•	Use Pinecone as vector DB.
	•	Allow namespace-per-collection (or index-per-user/collection — design option; implement namespaces first).
	•	Store chunk vectors and metadata fields (document_id, chunk_index, original_text, offsets, source_file, page, collection_id, author, created_at).
	•	Persist the same chunk + metadata in primary DB so UI can show original chunk data and changes.
	•	Upsert behavior:
	•	Upsert chunk embeddings into Pinecone namespace for the collection.
	•	Save an upsert log: mapping of chunk_id → pinecone_vector_id and pinecone namespace metadata.

## Search & RAG features
	•	Two query modes per collection:
	1.	Plain Query: single-shot semantic search against the collection (return top-k chunks with score + metadata).
	2.	Multi-turn Chat: RAG chat UI that:
	•	Maintains conversation history (full messages saved).
	•	Performs retrieval (top-k) each assistant turn, constructs prompt with retrieved chunks + system message + convo.
	•	Supports tool-calling: LLM can request executing the Pinecone search tool or other tools; the app executes tool, returns results to LLM, and stores the tool call and result in DB (transparent logging).
	•	Reranking support:
	•	Optionally rerank retrieved results via an OpenRouter reranker model (configurable).
	•	Expose selectables in UI for:
	•	number of retrieved chunks, rerank on/off, prompt template, temperature, max_tokens, model selection for LLM.

## LLM inference / OpenRouter
	•	All LLM calls go to OpenRouter base_url https://openrouter.ai/api/v1 (use provided python client example).
	•	Default LLM model string: "openai/gpt-oss-120b" (user-configurable; must be swappable).
	•	Browsing available models:
	•	Endpoint to GET /models from OpenRouter and filter by supported_parameters or output_modalities.
	•	Show model metadata on UI (name, context_length, tokens available, provider, pricing if present).
	•	Tool-calling:
	•	Expose Pinecone search as a tool function schema in OpenRouter chat requests.
	•	Implement tool execution loop: run model request → detect tool_call → execute tool locally (Pinecone query) → append tool result → re-call LLM → store all messages, tool calls and tool results in DB.
	•	Save tool call metadata: name, args, time, result payload, execution duration, errors.
	•	Streaming support (optional): stream tokens to UI from OpenRouter when model supports streaming.

## Transparency & traceability
	•	Persist everything in DB:
	•	raw uploaded files, original content, chunked texts, chunk embeddings metadata, mapping to Pinecone vectors
	•	ingestion logs (who, when, chunk settings)
	•	queries, chat messages, LLM responses, tool calls, tool results, token & usage counts
	•	UI must show:
	•	document view → list of chunks derived (with chunk text, offset, token count, vector id, Pinecone namespace)
	•	ability to view how a document was changed over time (versioning / re-ingestions)
	•	conversation view with expandable messages showing:
	•	model chosen, model metadata (context length), tokens used (input/output), tool calls (expandable), Pinecone hits used for the response
	•	context usage indicator: how many tokens of the model context are used vs capacity
	•	provider info (which underlying provider OpenRouter used) and model string
	•	Tool call visualization:
	•	show the tool JSON spec, arguments, returned data, and allow clicking to expand.


## UI / UX features
	•	Collection dashboard:
	•	list collections, create/edit/delete
	•	per-collection ingestion wizard with chunking / embed model / Pinecone namespace selection
	•	visualization: document → chunk tree / chunk list; interactive — click chunk to highlight text in original doc, show embedding id and similarity view
	•	Chat interface:
	•	standard chat with user/assistant messages, show which retrieved chunks were used, and show tool calls inline
	•	allow users to choose model, temperature, max_tokens on the fly
	•	save conversations, create multiple chat sessions per collection
	•	conversation history listing
	•	Admin / settings:
	•	environment config: OpenRouter API key, Pinecone API key, Pinecone region, default models, DB connection
	•	display usage metrics and logs (requests to OpenRouter and Pinecone)
	•	Visualizations:
	•	For each chunk/document: show similarity heatmap for query results (optional), or scatter/UMAP visualization for chunk embeddings (optional as enhancement — but include hook for later)
	•	Accessibility and responsive layout.
