/**
 * Default pipeline scaffolding: the definitions the Create Pipeline wizard
 * builds, mirroring the backend's hybrid (semantic + BM25) defaults in
 * `app/pipelines/defaults.py`. Kept apart from pipeline-utils so each module
 * holds one responsibility (and stays under the size cap).
 */

import type { IndexBackend, PipelineDefinition, PipelineKind } from "@/lib/types";

const PORT_SOURCE = "source";
const PORT_DOCUMENT = "document";
const PORT_CHUNKS = "chunks";
const PORT_EMBEDDED = "embedded";
const PORT_QUERY_EMBEDDING = "query_embedding";
const PORT_INDEXED = "indexed";
const PORT_REQUEST = "request";
const PORT_RESULTS = "results";
const NODE_QUERY_INPUT = "query-input";
const NODE_EMBED_QUERY = "embed-query";
const NODE_VECTOR_RETRIEVER = "vector-retriever";
const NODE_BM25_RETRIEVER = "bm25-retriever";
const NODE_FUSE_RESULTS = "fuse-results";
const NODE_RETRIEVAL_OUTPUT = "retrieval-output";
const NODE_INGEST_INPUT = "ingest-input";
const NODE_PARSE_DOCUMENT = "parse-document";
const NODE_CHUNK_DOCUMENT = "chunk-document";
const NODE_EMBED_CHUNKS = "embed-chunks";
const NODE_INDEX_CHUNKS = "index-chunks";
const NODE_INDEX_BM25 = "index-bm25";
const NODE_INGEST_OUTPUT = "ingest-output";

/** Unified vector-store node types (backend selected in config). */
export const INDEXER_NODE_TYPE = "indexer.vector";
export const RETRIEVER_NODE_TYPE = "retriever.vector";
export const BM25_INDEXER_NODE_TYPE = "indexer.bm25";
export const BM25_RETRIEVER_NODE_TYPE = "retriever.bm25";
export const RRF_FUSION_NODE_TYPE = "fusion.rrf";

// Scaffolds deliberately carry no node positions: the shared auto-layout
// (`layoutPipelineNodes`) places any definition whose nodes lack saved
// positions, so the wizard preview and the editor's first open both use the
// same algorithm as Tidy. Hand-placing coordinates here would duplicate
// layout knowledge the algorithm owns.

// Fallback name-length cap when the backend's capabilities aren't loaded yet
// (the real cap is BackendCapabilities.index_name_max_length).
const DEFAULT_INDEX_NAME_MAX_LENGTH = 45;
const BM25_INDEX_SUFFIX = "-bm25";

/** Derive the BM25 sibling index name paired with a dense index name. */
export const bm25SiblingIndexName = (
  indexName: string,
  maxLength: number = DEFAULT_INDEX_NAME_MAX_LENGTH,
) => {
  const base = indexName.slice(0, maxLength - BM25_INDEX_SUFFIX.length).replace(/-+$/, "");
  return `${base}${BM25_INDEX_SUFFIX}`;
};

export type DefaultDefinitionOptions = {
  indexName?: string;
  indexDimension?: number;
  embeddingConnectionId?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  /** Scaffold the parallel BM25 branch (mirrors the backend's hybrid defaults). */
  includeBm25?: boolean;
  /** The backend's index-name length cap (BackendCapabilities.index_name_max_length). */
  indexNameMaxLength?: number;
};

export const buildDefaultDefinition = (
  kind: PipelineKind,
  backend: IndexBackend,
  options: DefaultDefinitionOptions = {},
): PipelineDefinition => {
  const indexConfig: Record<string, unknown> = { backend };
  const indexName =
    typeof options.indexName === "string" && options.indexName.trim()
      ? options.indexName.trim()
      : undefined;
  if (indexName) {
    indexConfig.index_name = indexName;
  }
  const includeBm25 = options.includeBm25 ?? false;
  const bm25Config: Record<string, unknown> = { backend };
  if (indexName) {
    bm25Config.index_name = bm25SiblingIndexName(indexName, options.indexNameMaxLength);
  }
  const embedderConfig: Record<string, unknown> = {};
  if (options.embeddingConnectionId) {
    embedderConfig.connection_id = options.embeddingConnectionId;
  }
  if (options.embeddingModel) {
    embedderConfig.model_name = options.embeddingModel;
  }
  // Only the indexer carries the dimension. Setting it on the embedder would
  // send an explicit `dimensions` param to OpenRouter, which many embedding
  // models reject outright (no matryoshka support) -- models emit their
  // native dimension without it.
  if (typeof options.indexDimension === "number") {
    indexConfig.dimension = options.indexDimension;
  }

  if (kind === "retrieval") {
    const retrieverConfig = { ...indexConfig };
    delete retrieverConfig.dimension;
    const nodes: PipelineDefinition["nodes"] = [
      {
        id: NODE_QUERY_INPUT,
        type: "retrieval.input",
        name: "Retrieval Input",
        config: {},
      },
      {
        id: NODE_EMBED_QUERY,
        type: "embedder.text",
        name: "Embedder",
        config: embedderConfig,
      },
      {
        id: NODE_VECTOR_RETRIEVER,
        type: RETRIEVER_NODE_TYPE,
        name: "Semantic Retriever",
        config: retrieverConfig,
      },
      {
        id: NODE_RETRIEVAL_OUTPUT,
        type: "retrieval.output",
        name: "Retrieval Output",
        config: {},
      },
    ];
    const edges: PipelineDefinition["edges"] = [
      {
        id: "edge-retrieval-input",
        source: NODE_QUERY_INPUT,
        target: NODE_EMBED_QUERY,
        source_port: PORT_REQUEST,
        target_port: PORT_REQUEST,
      },
      {
        id: "edge-retrieval-embedder",
        source: NODE_EMBED_QUERY,
        target: NODE_VECTOR_RETRIEVER,
        source_port: PORT_QUERY_EMBEDDING,
        target_port: PORT_QUERY_EMBEDDING,
      },
    ];
    if (includeBm25) {
      nodes.push(
        {
          id: NODE_BM25_RETRIEVER,
          type: BM25_RETRIEVER_NODE_TYPE,
          name: "BM25 Retriever",
          config: bm25Config,
        },
        {
          id: NODE_FUSE_RESULTS,
          type: RRF_FUSION_NODE_TYPE,
          name: "RRF Fusion",
          config: {},
        },
      );
      edges.push(
        {
          id: "edge-input-bm25-retriever",
          source: NODE_QUERY_INPUT,
          target: NODE_BM25_RETRIEVER,
          source_port: PORT_REQUEST,
          target_port: PORT_REQUEST,
        },
        {
          id: "edge-semantic-fusion",
          source: NODE_VECTOR_RETRIEVER,
          target: NODE_FUSE_RESULTS,
          source_port: PORT_RESULTS,
          target_port: PORT_RESULTS,
        },
        {
          id: "edge-bm25-fusion",
          source: NODE_BM25_RETRIEVER,
          target: NODE_FUSE_RESULTS,
          source_port: PORT_RESULTS,
          target_port: PORT_RESULTS,
        },
        {
          id: "edge-fusion-output",
          source: NODE_FUSE_RESULTS,
          target: NODE_RETRIEVAL_OUTPUT,
          source_port: PORT_RESULTS,
          target_port: PORT_RESULTS,
        },
      );
    } else {
      edges.push({
        id: "edge-retrieval-output",
        source: NODE_VECTOR_RETRIEVER,
        target: NODE_RETRIEVAL_OUTPUT,
        source_port: PORT_RESULTS,
        target_port: PORT_RESULTS,
      });
    }
    return { nodes, edges, viewport: {} };
  }

  const nodes: PipelineDefinition["nodes"] = [
    {
      id: NODE_INGEST_INPUT,
      type: "ingestion.input",
      name: "Ingestion Input",
      config: {},
    },
    {
      id: NODE_PARSE_DOCUMENT,
      type: "parser.document",
      name: "Document Parser",
      config: {},
    },
    {
      id: NODE_CHUNK_DOCUMENT,
      type: "chunker.token",
      name: "Token Chunker",
      config: {
        chunk_size: options.chunkSize ?? 512,
        chunk_overlap: options.chunkOverlap ?? 200,
      },
    },
    {
      id: NODE_EMBED_CHUNKS,
      type: "embedder.text",
      name: "Embedder",
      config: embedderConfig,
    },
    {
      id: NODE_INDEX_CHUNKS,
      type: INDEXER_NODE_TYPE,
      name: "Semantic Indexer",
      config: indexConfig,
    },
    {
      id: NODE_INGEST_OUTPUT,
      type: "ingestion.output",
      name: "Ingestion Output",
      config: {},
    },
  ];
  const edges: PipelineDefinition["edges"] = [
    {
      id: "edge-ingest-input-parser",
      source: NODE_INGEST_INPUT,
      target: NODE_PARSE_DOCUMENT,
      source_port: PORT_SOURCE,
      target_port: PORT_SOURCE,
    },
    {
      id: "edge-parser-chunker",
      source: NODE_PARSE_DOCUMENT,
      target: NODE_CHUNK_DOCUMENT,
      source_port: PORT_DOCUMENT,
      target_port: PORT_DOCUMENT,
    },
    {
      id: "edge-chunker-embedder",
      source: NODE_CHUNK_DOCUMENT,
      target: NODE_EMBED_CHUNKS,
      source_port: PORT_CHUNKS,
      target_port: PORT_CHUNKS,
    },
    {
      id: "edge-embedder-indexer",
      source: NODE_EMBED_CHUNKS,
      target: NODE_INDEX_CHUNKS,
      source_port: PORT_EMBEDDED,
      target_port: PORT_EMBEDDED,
    },
    {
      id: "edge-indexer-output",
      source: NODE_INDEX_CHUNKS,
      target: NODE_INGEST_OUTPUT,
      source_port: PORT_INDEXED,
      target_port: PORT_INDEXED,
    },
  ];
  if (includeBm25) {
    nodes.push({
      id: NODE_INDEX_BM25,
      type: BM25_INDEXER_NODE_TYPE,
      name: "BM25 Indexer",
      config: bm25Config,
    });
    edges.push(
      {
        id: "edge-chunker-bm25-indexer",
        source: NODE_CHUNK_DOCUMENT,
        target: NODE_INDEX_BM25,
        source_port: PORT_CHUNKS,
        target_port: PORT_CHUNKS,
      },
      {
        id: "edge-bm25-indexer-output",
        source: NODE_INDEX_BM25,
        target: NODE_INGEST_OUTPUT,
        source_port: PORT_INDEXED,
        target_port: PORT_INDEXED,
      },
    );
  }
  return { nodes, edges, viewport: {} };
};
