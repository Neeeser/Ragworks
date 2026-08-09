# Docker deployment setups

The root `docker-compose.yml` starts the all-in-one Ragworks container (backend,
frontend, and embedded PostgreSQL). It does not start a model service. The optional Compose overlays in
`deploy/compose/` add services on the same internal Docker network. They do not
publish inference ports to the host.

## Select a setup

| Setup | Compose files | Connections configured in Ragworks |
| --- | --- | --- |
| Hosted providers | `docker-compose.yml` | Hosted chat, embedding, and reranking providers. |
| Local Ollama | Base + `ollama.yml` | Ollama for chat and/or embeddings. |
| Hosted chat with local TEI | Base + `tei-embedding.yml` and/or `tei-reranker.yml` | Hosted chat; TEI for embeddings and/or reranking. |
| Local chat with local TEI | Base + `ollama.yml`, `tei-embedding.yml`, and/or `tei-reranker.yml` | Ollama for chat; TEI for embeddings and/or reranking. |

An overlay only makes its service reachable. Add the corresponding provider
connection in Ragworks after the stack starts. Use these internal URLs from the
Ragworks container:

| Service | Connection type | Base URL |
| --- | --- | --- |
| `ollama` | Ollama | `http://ollama:11434` |
| `tei-embedding` | TEI | `http://tei-embedding:80` |
| `tei-reranker` | TEI | `http://tei-reranker:80` |

Use a TEI embedding connection for embedding nodes and a separate TEI reranking
connection for reranker nodes. Each TEI service loads one model.

## Docker Compose CLI

Run commands from the repository root. Compose merges files in the order passed,
so put `docker-compose.yml` first and add the required overlays after it.

| Services | Command |
| --- | --- |
| Base only | `docker compose -f docker-compose.yml config` |
| Ollama | `docker compose -f docker-compose.yml -f deploy/compose/ollama.yml config` |
| TEI embedding | `docker compose -f docker-compose.yml -f deploy/compose/tei-embedding.yml config` |
| TEI reranker | `docker compose -f docker-compose.yml -f deploy/compose/tei-reranker.yml config` |
| Ollama + TEI embedding | `docker compose -f docker-compose.yml -f deploy/compose/ollama.yml -f deploy/compose/tei-embedding.yml config` |
| Ollama + TEI reranker | `docker compose -f docker-compose.yml -f deploy/compose/ollama.yml -f deploy/compose/tei-reranker.yml config` |
| TEI embedding + TEI reranker | `docker compose -f docker-compose.yml -f deploy/compose/tei-embedding.yml -f deploy/compose/tei-reranker.yml config` |
| Ollama + TEI embedding + TEI reranker | `docker compose -f docker-compose.yml -f deploy/compose/ollama.yml -f deploy/compose/tei-embedding.yml -f deploy/compose/tei-reranker.yml config` |

Run the selected command with `config` before deploying. It resolves variables
and prints the final stack. Replace `config` with `up -d` to start that same
stack. Use the same file list for later `pull`, `logs`, `exec`, and `down`
commands so Compose addresses the same project and services.

For example, start Ollama with TEI embedding and reranking:

```bash
docker compose -f docker-compose.yml \
  -f deploy/compose/ollama.yml \
  -f deploy/compose/tei-embedding.yml \
  -f deploy/compose/tei-reranker.yml up -d
```

Ollama starts without a model. Pull a model after its service is running, then
select that model when creating the Ollama connection:

```bash
docker compose -f docker-compose.yml -f deploy/compose/ollama.yml \
  exec ollama ollama pull llama3.2
```

`llama3.2` is an example. Select a model appropriate for the chat or embedding
workload and the resources available to the host.

### TEI variables

The TEI overlays use these Compose variables. Their fallback values are examples
for a CPU x86_64 deployment; they do not define a supported-model list. Set an
image appropriate for the host hardware and any TEI-compatible model for the
required task. The model weights are cached in the named volume for the service.

| Variable | Example fallback |
| --- | --- |
| `TEI_EMBEDDING_IMAGE` | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9` |
| `TEI_EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` |
| `TEI_RERANKER_IMAGE` | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9` |
| `TEI_RERANKER_MODEL` | `BAAI/bge-reranker-base` |

Ragworks reads the served model from each TEI server's `/info` endpoint and
caches it briefly. If a TEI service is restarted with a different
`TEI_*_MODEL`, embedding and reranking requests against the old selection are
rejected within about 30 seconds with a message naming the newly served model.
After changing a model, re-validate the connection, reselect the model in any
pipeline that uses it, and re-ingest collections whose embeddings were built
with the previous model.

For example, set values for one command without creating an environment file:

```bash
TEI_EMBEDDING_IMAGE=ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-latest \
TEI_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B \
docker compose -f docker-compose.yml -f deploy/compose/tei-embedding.yml up -d
```

The ARM64 CPU image uses a rolling tag because GHCR does not publish the
versioned `cpu-arm64-1.9` tag. Pin the resolved image digest for a reproducible
deployment.

For a GPU image, device access and runtime configuration depend on the host and
selected TEI image. Follow the image provider's hardware requirements before
changing `TEI_*_IMAGE`.

## Portainer

For a Git-backed Portainer stack, set **Compose path** to
`docker-compose.yml`. In **Additional paths**, add each selected relative path in
this order:

1. `deploy/compose/ollama.yml`
2. `deploy/compose/tei-embedding.yml`
3. `deploy/compose/tei-reranker.yml`

Only add the paths for services that the stack needs. Portainer processes
Additional paths like repeated Compose `-f` arguments, so the order matches the
CLI commands above. Set any `TEI_*_IMAGE` and `TEI_*_MODEL` values in the stack's
environment-variable section before deployment.

For a Portainer stack created with the web editor or a single uploaded file,
merge the selected overlay into the base file before pasting or uploading. Copy
the service mapping below `services:` and the matching volume name below
`volumes:` in the root file; do not append a second top-level `services` or
`volumes` key.

### Manual overlay fragments

Add this under the existing `services:` mapping to include Ollama:

```yaml
  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama-data:/root/.ollama
```

Add this under the existing `volumes:` mapping:

```yaml
  ollama-data:
```

Add this under the existing `services:` mapping to include TEI embeddings:

```yaml
  tei-embedding:
    image: ${TEI_EMBEDDING_IMAGE:-ghcr.io/huggingface/text-embeddings-inference:cpu-1.9}
    command:
      - --model-id
      - ${TEI_EMBEDDING_MODEL:-BAAI/bge-small-en-v1.5}
    volumes:
      - tei-embedding-data:/data
```

Add this under the existing `volumes:` mapping:

```yaml
  tei-embedding-data:
```

Add this under the existing `services:` mapping to include a TEI reranker:

```yaml
  tei-reranker:
    image: ${TEI_RERANKER_IMAGE:-ghcr.io/huggingface/text-embeddings-inference:cpu-1.9}
    command:
      - --model-id
      - ${TEI_RERANKER_MODEL:-BAAI/bge-reranker-base}
    volumes:
      - tei-reranker-data:/data
```

Add this under the existing `volumes:` mapping:

```yaml
  tei-reranker-data:
```

The manual fragments are the same service definitions as the overlay files. Use
the setup table to decide which fragments and provider connections to add.
