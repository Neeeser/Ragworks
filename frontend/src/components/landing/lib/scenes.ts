import { buildSceneFlow } from "@/components/landing/lib/demo-flow";

import type { DemoFlow, DemoNode, SceneDefinition } from "@/components/landing/lib/demo-flow";

/**
 * The landing hero's scene registry — the pipeline configurations the
 * backdrop rotates through, Factorio-intro style. Adding a scene to the
 * rotation is one `LANDING_SCENES` entry; `scenes.test.ts` guards that every
 * entry builds a self-consistent graph.
 */

export type LandingSceneKind = "ingestion" | "retrieval";

export type LandingScene = {
  id: string;
  kind: LandingSceneKind;
  /** Build the scene's graph + playback stages. Pure — safe to memoize. */
  build: () => DemoFlow;
};

// -- shared node vocabulary --------------------------------------------------

// Node ids referenced across edges and stages — defined once.
const NODE_EMBED_QUERY = "embed-query";
const NODE_INDEX_BM25 = "index-bm25";
const NODE_BM25_RETRIEVE = "bm25-retrieve";

// Fake-but-plausible signature values so no card reads "no model selected".
const EMBED_CONFIG = { model_name: "all-MiniLM-L6-v2", dimension: 384 } as const;
const DENSE_INDEX_CONFIG = {
  index_name: "ragworks-docs",
  namespace: "docs",
  backend: "pgvector",
} as const;
const BM25_INDEX_CONFIG = {
  index_name: "ragworks-docs-bm25",
  namespace: "docs",
  backend: "pgvector",
} as const;

const PORT = {
  file: { key: "file", label: "Source file", dataType: "document_source" },
  document: { key: "document", label: "Parsed document", dataType: "document" },
  chunks: { key: "chunks", label: "Chunks", dataType: "chunk_batch" },
  embedded: { key: "embedded", label: "Embedded chunks", dataType: "embedded_batch" },
  indexed: { key: "indexed", label: "Indexed chunks", dataType: "indexed_batch" },
  query: { key: "query", label: "Query", dataType: "query_request" },
  queryEmbedding: { key: "embedding", label: "Query embedding", dataType: "query_embedding" },
  results: { key: "results", label: "Results", dataType: "retrieval_results" },
} as const;

const source = (col: number): DemoNode => ({
  id: "source",
  nodeType: "ingestion.source",
  label: "Document",
  description: "A source file enters the pipeline.",
  output: PORT.file,
  col,
});

const parse = (col: number): DemoNode => ({
  id: "parse",
  nodeType: "parser.pdf",
  label: "Parse",
  description: "Extract clean text from the raw file.",
  input: PORT.file,
  output: PORT.document,
  col,
});

const chunk = (col: number): DemoNode => ({
  id: "chunk",
  nodeType: "chunker.recursive",
  label: "Chunk",
  description: "Split text into overlapping passages.",
  input: PORT.document,
  output: PORT.chunks,
  config: { chunk_size: 400, chunk_overlap: 40 },
  col,
});

const embed = (col: number): DemoNode => ({
  id: "embed",
  nodeType: "embedder.text",
  label: "Embed",
  description: "Turn each chunk into a vector.",
  input: PORT.chunks,
  output: PORT.embedded,
  config: EMBED_CONFIG,
  col,
});

const index = (col: number): DemoNode => ({
  id: "index",
  nodeType: "indexer.vector",
  label: "Vector Index",
  description: "Store vectors in the collection.",
  input: PORT.embedded,
  output: PORT.indexed,
  config: DENSE_INDEX_CONFIG,
  col,
});

const query = (col: number): DemoNode => ({
  id: "query",
  nodeType: "retrieval.input",
  label: "Query",
  description: "A user question enters the pipeline.",
  output: PORT.query,
  col,
});

const embedQuery = (col: number): DemoNode => ({
  id: NODE_EMBED_QUERY,
  nodeType: "embedder.text",
  label: "Embed Query",
  description: "Turn the question into a vector.",
  input: PORT.query,
  output: PORT.queryEmbedding,
  config: EMBED_CONFIG,
  col,
});

const retrieve = (col: number): DemoNode => ({
  id: "retrieve",
  nodeType: "retriever.vector",
  label: "Vector Retrieve",
  description: "Find the passages that matter.",
  input: PORT.queryEmbedding,
  output: PORT.results,
  config: DENSE_INDEX_CONFIG,
  col,
});

const results = (col: number): DemoNode => ({
  id: "results",
  nodeType: "retrieval.output",
  label: "Results",
  description: "Grounded evidence, ranked.",
  input: PORT.results,
  col,
});

// -- scene definitions --------------------------------------------------------

const SEMANTIC_INGESTION: SceneDefinition = {
  nodes: [source(0), parse(1), chunk(2), embed(3), index(4)],
  edges: [
    ["source", "parse"],
    ["parse", "chunk"],
    ["chunk", "embed"],
    ["embed", "index"],
  ],
  stages: [["source"], ["parse"], ["chunk"], ["embed"], ["index"]],
};

const SEMANTIC_RETRIEVAL: SceneDefinition = {
  nodes: [query(0), embedQuery(1), retrieve(2), results(3)],
  edges: [
    ["query", NODE_EMBED_QUERY],
    [NODE_EMBED_QUERY, "retrieve"],
    ["retrieve", "results"],
  ],
  stages: [["query"], [NODE_EMBED_QUERY], ["retrieve"], ["results"]],
};

// The BM25 branch sits one row below the semantic path, in the column after
// its source — mirroring the editor's default hybrid scaffold so wires
// descend in the gap instead of hiding behind cards.
const HYBRID_INGESTION: SceneDefinition = {
  nodes: [
    source(0),
    parse(1),
    chunk(2),
    embed(3),
    index(4),
    {
      id: NODE_INDEX_BM25,
      nodeType: "indexer.bm25",
      label: "BM25 Index",
      description: "Index raw chunk text for keyword search.",
      input: PORT.chunks,
      output: PORT.indexed,
      config: BM25_INDEX_CONFIG,
      col: 3,
      row: 1,
    },
    {
      id: "collection",
      nodeType: "ingestion.output",
      label: "Collection",
      description: "Both indexes back one collection.",
      input: PORT.indexed,
      col: 5,
      row: 0.5,
    },
  ],
  edges: [
    ["source", "parse"],
    ["parse", "chunk"],
    ["chunk", "embed"],
    ["chunk", NODE_INDEX_BM25],
    ["embed", "index"],
    ["index", "collection"],
    [NODE_INDEX_BM25, "collection"],
  ],
  stages: [
    ["source"],
    ["parse"],
    ["chunk"],
    // The payload splits: embeddings on the main row, keywords below. When
    // this stage ends, both branches depart at once — embed's dot to the
    // vector index and BM25's dot straight to the collection.
    ["embed", NODE_INDEX_BM25],
    ["index"],
    ["collection"],
  ],
};

const HYBRID_RETRIEVAL: SceneDefinition = {
  nodes: [
    query(0),
    embedQuery(1),
    retrieve(2),
    {
      id: NODE_BM25_RETRIEVE,
      nodeType: "retriever.bm25",
      label: "BM25 Retrieve",
      description: "Match the question's exact keywords.",
      input: PORT.query,
      output: PORT.results,
      config: BM25_INDEX_CONFIG,
      col: 1,
      row: 1,
    },
    {
      id: "fusion",
      nodeType: "fusion.rrf",
      label: "RRF Fusion",
      description: "Merge both rankings by reciprocal rank.",
      input: PORT.results,
      output: PORT.results,
      config: { k: 60 },
      col: 3,
      row: 0.5,
    },
    results(4),
  ],
  edges: [
    ["query", NODE_EMBED_QUERY],
    ["query", NODE_BM25_RETRIEVE],
    [NODE_EMBED_QUERY, "retrieve"],
    ["retrieve", "fusion"],
    [NODE_BM25_RETRIEVE, "fusion"],
    ["fusion", "results"],
  ],
  stages: [
    ["query"],
    // The query splits: semantic branch above, keyword branch below. When
    // this stage ends, both branches depart at once — the embedding to the
    // vector retriever and BM25's results straight to the fusion node.
    [NODE_EMBED_QUERY, NODE_BM25_RETRIEVE],
    ["retrieve"],
    ["fusion"],
    ["results"],
  ],
};

export const LANDING_SCENES: LandingScene[] = [
  { id: "semantic-ingestion", kind: "ingestion", build: () => buildSceneFlow(SEMANTIC_INGESTION) },
  { id: "semantic-retrieval", kind: "retrieval", build: () => buildSceneFlow(SEMANTIC_RETRIEVAL) },
  { id: "hybrid-ingestion", kind: "ingestion", build: () => buildSceneFlow(HYBRID_INGESTION) },
  { id: "hybrid-retrieval", kind: "retrieval", build: () => buildSceneFlow(HYBRID_RETRIEVAL) },
];
