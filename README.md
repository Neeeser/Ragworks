<div align="center">

# Ragworks

### Follow every document from upload to answer.

**Build and inspect retrieval pipelines as directed graphs—from document
ingestion through retrieval and chat.**

[![CI](https://github.com/Neeeser/Ragworks/actions/workflows/ci.yml/badge.svg)](https://github.com/Neeeser/Ragworks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-frontend-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pgvector](https://img.shields.io/badge/pgvector-default-336791?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Pinecone](https://img.shields.io/badge/Pinecone-optional-000000?logo=pinecone)](https://www.pinecone.io/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-supported-6467F2)](https://openrouter.ai/)

[Why Ragworks](#-why-ragworks) · [Features](#-features) · [How it works](#-how-it-works) · [Quick start](#-quick-start) · [Development](#development)

</div>

<p align="center">
  <a href="docs/assets/pipeline-flow-dark.png">
    <picture>
      <source media="(prefers-color-scheme: light) and (prefers-reduced-motion: reduce)" srcset="docs/assets/pipeline-flow-light.png">
      <source media="(prefers-color-scheme: dark) and (prefers-reduced-motion: reduce)" srcset="docs/assets/pipeline-flow-dark.png">
      <source media="(prefers-color-scheme: light)" srcset="docs/assets/pipeline-flow-light.gif">
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/pipeline-flow-dark.gif">
      <img src="docs/assets/pipeline-flow-dark.gif" alt="The default Ragworks ingestion and retrieval pipelines running through semantic and BM25 branches" width="100%">
    </picture>
  </a>
</p>

## 💡 Why Ragworks

Ragworks is an open-source RAG workbench for building, comparing, and inspecting
retrieval workflows on your own infrastructure. Ingestion and retrieval are
editable node graphs, making it easy to change parsing, chunking, embedding,
indexing, and retrieval strategies without rewriting the application. Each run
records node inputs, outputs, duration, and status so you can understand how a
pipeline behaved and where its results can be improved.

The included Docker Compose stack runs Ragworks with PostgreSQL, pgvector, and
BM25 search locally. Ragworks uses OpenRouter for embeddings and chat models,
with Pinecone available as an alternative vector store.

## ✨ Features

- **Visual pipelines:** build ingestion and retrieval graphs with typed ports and
  validation before execution.
- **Execution traces:** inspect node inputs, outputs, duration, and status against
  the exact pipeline version that ran.
- **Hybrid retrieval:** combine semantic and BM25 results with reciprocal rank
  fusion.
- **Pluggable vector storage:** keep vectors in the included PostgreSQL instance
  with pgvector or select Pinecone per pipeline.
- **Collection-aware chat:** stream multi-turn conversations that can search one
  or more document collections.
- **Embedding visualization:** project collection embeddings for interactive
  inspection.
- **Runtime administration:** manage provider credentials per user and application
  settings centrally.

## 🚀 Quick start

Ragworks publishes backend and frontend container images for each release. To run
the default stack, save the following as `docker-compose.yml`:

```yaml
name: ragworks

services:
  postgres:
    image: paradedb/paradedb:latest-pg17
    environment:
      POSTGRES_USER: ragworks
      POSTGRES_PASSWORD: ragworks
      POSTGRES_DB: ragworks
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ragworks"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    image: ghcr.io/neeeser/ragworks-backend:latest
    environment:
      DATABASE_URL: postgresql+psycopg://ragworks:ragworks@postgres:5432/ragworks
    volumes:
      - document-storage:/data/storage
      - backend-config:/data/config
    depends_on:
      postgres:
        condition: service_healthy

  frontend:
    image: ghcr.io/neeeser/ragworks-frontend:latest
    environment:
      API_PROXY_TARGET: http://backend:8000
    ports:
      - "7247:3000"
    depends_on:
      - backend

volumes:
  postgres-data:
  document-storage:
  backend-config:
```

Start the services:

```bash
docker compose up -d
```

Open <http://localhost:7247>. The first account becomes the administrator. In
the current release, the setup flow asks for an OpenRouter API key, selects an
embedding model, and creates the initial collection. Provider credentials are
stored per user and can be updated from the settings page.

To update an existing installation:

```bash
docker compose pull
docker compose up -d
```

The Compose file follows the current release through the `latest` image tag. For
a reproducible deployment, replace `latest` with a version from the
[releases page](https://github.com/Neeeser/Ragworks/releases).

## 🔎 How it works

**A Ragworks pipeline is a directed graph.** Nodes represent parsing, chunking,
embedding, indexing, retrieval, fusion, and output stages. Typed edges define how
data moves between them, and validation catches incompatible ports, cycles, and
invalid configuration before a run starts.

Pipeline definitions store nodes, typed connections, and configuration as a
versioned DAG. Pipelines can be assembled in the visual editor, then validated
for required inputs, compatible port types, cycles, and invalid node
configuration before they run.

Graph dependencies determine execution order. Each run retains the exact
pipeline version it used and records node-level inputs, outputs, timing, and
status. This connects an answer back to the modeled workflow that produced it
and makes individual stages easier to inspect and compare.

The backend uses FastAPI, Pydantic, SQLModel, PostgreSQL, and pgvector. The
frontend uses Next.js, React, and TypeScript. See the
[development guide](docs/DEVELOPMENT.md) for the repository layout and API
surface.

## Development

Local development requires Python 3.11 or later, Node.js 22, PostgreSQL, and
[uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/Neeeser/Ragworks.git
cd Ragworks
make env
make run
```

The backend runs at <http://localhost:8000> and the frontend at
<http://localhost:3000>. Provider credentials are configured in the UI rather
than an environment file.

Run the verification gate for each area you change:

```bash
make verify
make coverage

cd frontend
npm run verify
cd ..
make format-check-frontend
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request conventions and
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed setup and architecture
notes.

## 🤝 Contributing

Issues and pull requests are welcome. Bug fixes require a regression test that
fails before the fix and passes afterward. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Ragworks is available under the [MIT License](LICENSE).
