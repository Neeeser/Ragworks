/**
 * Default pipeline scaffolding: the definitions the Create Pipeline wizard
 * builds, mirroring the backend's hybrid (semantic + BM25) defaults in
 * `app/pipelines/defaults.py`. Kept apart from pipeline-utils so each module
 * holds one responsibility (and stays under the size cap).
 */

import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "@/lib/chunk-defaults";

import type { IndexBackend, PipelineDefinition, PipelineKind, PipelineVariable } from "@/lib/types";

const PORT_SOURCE = "source";
const PORT_ITEMS = "items";
const NODE_QUERY_INPUT = "query-input";
const NODE_EMBED_QUERY = "embed-query";
const NODE_VECTOR_RETRIEVER = "vector-retriever";
const NODE_BM25_RETRIEVER = "bm25-retriever";
const NODE_FUSE_RESULTS = "fuse-results";
const NODE_LIMIT_RESULTS = "limit-results";
const NODE_RETRIEVAL_OUTPUT = "retrieval-output";
const NODE_INGEST_INPUT = "ingest-input";
const NODE_MERGE_ITEMS = "merge-items";
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
export const LIMIT_NODE_TYPE = "limit.results";

// Scaffolds deliberately carry no node positions: the shared auto-layout
// (`layoutPipelineNodes`) places any definition whose nodes lack saved
// positions, so the wizard preview and the editor's first open both use the
// same algorithm as Tidy. Hand-placing coordinates here would duplicate
// layout knowledge the algorithm owns.

// Fallback name-length cap when the backend's capabilities aren't loaded yet
// (the real cap is BackendCapabilities.index_name_max_length).
const DEFAULT_INDEX_NAME_MAX_LENGTH = 45;
const BM25_INDEX_SUFFIX = "-bm25";

// Mirrors the backend scaffold (`app/pipelines/defaults.py`): retrieval
// pipelines declare the caller-facing result limit as an input variable
// (the retrieval input node accepts it by name), so the search page and the
// chat tool schema see the same argument whether the pipeline was scaffolded
// by the wizard or by the backend.
const DEFAULT_RETRIEVAL_VARIABLES: PipelineVariable[] = [
  {
    name: "result_limit",
    type: "integer",
    source: "input",
    description: "Maximum number of results to return.",
    value: 5,
    minimum: 1,
    maximum: 10,
    expose_to_llm: true,
  },
];

/** Derive the BM25 sibling index name paired with a dense index name. */
export const bm25SiblingIndexName = (
  indexName: string,
  maxLength: number = DEFAULT_INDEX_NAME_MAX_LENGTH,
) => {
  const base = indexName.slice(0, maxLength - BM25_INDEX_SUFFIX.length).replace(/-+$/, "");
  return `${base}${BM25_INDEX_SUFFIX}`;
};

/**
 * How an ingestion scaffold reads uploaded files. Each mode wires a
 * different set of parse nodes off the input; the embed-and-index chain
 * downstream is the same one.
 */
export type IntakeMode = "text" | "text_images" | "images";

type ScaffoldNode = { id: string; type: string; name: string };

const PARSE_TEXT: ScaffoldNode = { id: "parse-text", type: "parse.text", name: "Extract Text" };
const PARSE_MEDIA_FILE: ScaffoldNode = {
  id: "parse-media-file",
  type: "parse.media_file",
  name: "Media File",
};
// A 150-DPI page render is 1275x1650 and vision models downsample above their
// own long-edge limit, so an image-only scaffold resizes before embedding
// rather than paying to ship detail the model discards.
const RESIZE_IMAGES: ScaffoldNode = {
  id: "resize-images",
  type: "image.resize",
  name: "Resize Images",
};

type IntakeScaffold = {
  parsers: ScaffoldNode[];
  chunked: boolean;
  /** An items→items node wired between the parse branches and the embedder. */
  transform?: ScaffoldNode;
};

/**
 * The parse nodes each intake mode scaffolds, and whether its items are
 * chunked. Page renders and standalone images carry no text, so the
 * image-only mode wires no chunker rather than one that passes everything
 * through untouched.
 */
const INTAKE_PARSE_NODES: Record<IntakeMode, IntakeScaffold> = {
  text: { parsers: [PARSE_TEXT], chunked: true },
  text_images: {
    parsers: [
      PARSE_TEXT,
      { id: "parse-embedded-media", type: "parse.embedded_media", name: "Extract Media" },
      PARSE_MEDIA_FILE,
    ],
    chunked: true,
  },
  images: {
    parsers: [
      { id: "parse-page-images", type: "parse.page_images", name: "Render as Images" },
      PARSE_MEDIA_FILE,
    ],
    chunked: false,
    transform: RESIZE_IMAGES,
  },
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
  /** How the ingestion scaffold reads uploads; defaults to text documents. */
  intake?: IntakeMode;
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
    // Fetch depth is always explicit — the declared result limit, never an
    // invisible request fallback.
    const retrieverConfig: Record<string, unknown> = {
      ...indexConfig,
      top_k: { $expr: "result_limit" },
    };
    delete retrieverConfig.dimension;
    const bm25RetrieverConfig: Record<string, unknown> = {
      ...bm25Config,
      top_k: { $expr: "result_limit" },
    };
    const nodes: PipelineDefinition["nodes"] = [
      {
        id: NODE_QUERY_INPUT,
        type: "retrieval.input",
        name: "Retrieval Input",
        config: { arguments: ["result_limit"] },
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
        source_port: PORT_ITEMS,
        target_port: PORT_ITEMS,
      },
      {
        id: "edge-retrieval-embedder",
        source: NODE_EMBED_QUERY,
        target: NODE_VECTOR_RETRIEVER,
        source_port: PORT_ITEMS,
        target_port: PORT_ITEMS,
      },
    ];
    if (includeBm25) {
      nodes.push(
        {
          id: NODE_BM25_RETRIEVER,
          type: BM25_RETRIEVER_NODE_TYPE,
          name: "BM25 Retriever",
          config: bm25RetrieverConfig,
        },
        {
          id: NODE_FUSE_RESULTS,
          type: RRF_FUSION_NODE_TYPE,
          name: "RRF Fusion",
          config: {},
        },
        // Fusion never cuts; Result Limit is the explicit cut back to the
        // declared result_limit input variable.
        {
          id: NODE_LIMIT_RESULTS,
          type: LIMIT_NODE_TYPE,
          name: "Result Limit",
          config: { max_results: { $expr: "result_limit" } },
        },
      );
      edges.push(
        {
          id: "edge-input-bm25-retriever",
          source: NODE_QUERY_INPUT,
          target: NODE_BM25_RETRIEVER,
          source_port: PORT_ITEMS,
          target_port: PORT_ITEMS,
        },
        {
          id: "edge-semantic-fusion",
          source: NODE_VECTOR_RETRIEVER,
          target: NODE_FUSE_RESULTS,
          source_port: PORT_ITEMS,
          target_port: PORT_ITEMS,
        },
        {
          id: "edge-bm25-fusion",
          source: NODE_BM25_RETRIEVER,
          target: NODE_FUSE_RESULTS,
          source_port: PORT_ITEMS,
          target_port: PORT_ITEMS,
        },
        {
          id: "edge-fusion-limit",
          source: NODE_FUSE_RESULTS,
          target: NODE_LIMIT_RESULTS,
          source_port: PORT_ITEMS,
          target_port: PORT_ITEMS,
        },
        {
          id: "edge-limit-output",
          source: NODE_LIMIT_RESULTS,
          target: NODE_RETRIEVAL_OUTPUT,
          source_port: PORT_ITEMS,
          target_port: PORT_ITEMS,
        },
      );
    } else {
      edges.push({
        id: "edge-retrieval-output",
        source: NODE_VECTOR_RETRIEVER,
        target: NODE_RETRIEVAL_OUTPUT,
        source_port: PORT_ITEMS,
        target_port: PORT_ITEMS,
      });
    }
    return {
      nodes,
      edges,
      viewport: {},
      variables: DEFAULT_RETRIEVAL_VARIABLES.map((variable) => ({ ...variable })),
    };
  }

  const intakeNodes = INTAKE_PARSE_NODES[options.intake ?? "text"];
  const chunked = intakeNodes.chunked;
  const nodes: PipelineDefinition["nodes"] = [
    {
      id: NODE_INGEST_INPUT,
      type: "ingestion.input",
      name: "Ingestion Input",
      config: {},
    },
    ...intakeNodes.parsers.map((parser) => ({
      id: parser.id,
      type: parser.type,
      name: parser.name,
      config: {},
    })),
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
  // Several parse nodes fan out from the input and rejoin through Merge Items,
  // so one embed-and-index chain serves every intake branch.
  const merges = intakeNodes.parsers.length > 1;
  if (merges) {
    nodes.push({ id: NODE_MERGE_ITEMS, type: "merge.items", name: "Merge Items", config: {} });
  }
  if (chunked) {
    nodes.push({
      id: NODE_CHUNK_DOCUMENT,
      type: "chunker.token",
      name: "Token Chunker",
      config: {
        chunk_size: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
        chunk_overlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      },
    });
  }
  // The node every parse branch feeds, and the node that feeds the embedder.
  const joinNode = merges ? NODE_MERGE_ITEMS : intakeNodes.parsers[0].id;
  const transform = intakeNodes.transform;
  const preTransform = chunked ? NODE_CHUNK_DOCUMENT : joinNode;
  const embedSource = transform ? transform.id : preTransform;
  if (transform) {
    nodes.push({ id: transform.id, type: transform.type, name: transform.name, config: {} });
  }
  const edges: PipelineDefinition["edges"] = intakeNodes.parsers.flatMap((parser) => [
    {
      id: `edge-ingest-input-${parser.id}`,
      source: NODE_INGEST_INPUT,
      target: parser.id,
      source_port: PORT_ITEMS,
      target_port: PORT_SOURCE,
    },
    ...(merges
      ? [
          {
            id: `edge-${parser.id}-merge`,
            source: parser.id,
            target: NODE_MERGE_ITEMS,
            source_port: PORT_ITEMS,
            target_port: PORT_ITEMS,
          },
        ]
      : []),
  ]);
  if (chunked) {
    edges.push({
      id: "edge-parser-chunker",
      source: joinNode,
      target: NODE_CHUNK_DOCUMENT,
      source_port: PORT_ITEMS,
      target_port: PORT_ITEMS,
    });
  }
  if (transform) {
    edges.push({
      id: `edge-${transform.id}-input`,
      source: preTransform,
      target: transform.id,
      source_port: PORT_ITEMS,
      target_port: PORT_ITEMS,
    });
  }
  edges.push(
    {
      id: "edge-chunker-embedder",
      source: embedSource,
      target: NODE_EMBED_CHUNKS,
      source_port: PORT_ITEMS,
      target_port: PORT_ITEMS,
    },
    {
      id: "edge-embedder-indexer",
      source: NODE_EMBED_CHUNKS,
      target: NODE_INDEX_CHUNKS,
      source_port: PORT_ITEMS,
      target_port: PORT_ITEMS,
    },
    {
      id: "edge-indexer-output",
      source: NODE_INDEX_CHUNKS,
      target: NODE_INGEST_OUTPUT,
      source_port: PORT_ITEMS,
      target_port: PORT_ITEMS,
    },
  );
  // BM25 indexes chunk text, so it only rides along where text is chunked.
  if (includeBm25 && chunked) {
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
        source_port: PORT_ITEMS,
        target_port: PORT_ITEMS,
      },
      {
        id: "edge-bm25-indexer-output",
        source: NODE_INDEX_BM25,
        target: NODE_INGEST_OUTPUT,
        source_port: PORT_ITEMS,
        target_port: PORT_ITEMS,
      },
    );
  }
  return { nodes, edges, viewport: {} };
};
