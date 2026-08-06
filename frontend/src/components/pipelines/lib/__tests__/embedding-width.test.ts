import { describe, expect, it } from "vitest";

import {
  resolveExpectedDimension,
  upstreamEmbedderIdentity,
} from "@/components/pipelines/lib/embedding-width";
import { makeCatalogModel } from "@/test/fixtures";

import type {
  EmbeddingWidthEdge,
  EmbeddingWidthNode,
} from "@/components/pipelines/lib/embedding-width";

const CONNECTION_ID = "conn-1";
const EMBEDDER_ID = "embedder-1";
const INDEXER_ID = "indexer-1";
const MODEL_NAME = "text-embed-small";

const embedder = (overrides: Partial<EmbeddingWidthNode> = {}): EmbeddingWidthNode => ({
  id: EMBEDDER_ID,
  nodeType: "embedder.text",
  config: { connection_id: CONNECTION_ID, model_name: MODEL_NAME },
  ...overrides,
});

const indexer = (overrides: Partial<EmbeddingWidthNode> = {}): EmbeddingWidthNode => ({
  id: INDEXER_ID,
  nodeType: "indexer.pgvector",
  config: {},
  ...overrides,
});

describe("resolveExpectedDimension", () => {
  it("resolves the catalog width of the embedder feeding a directly connected indexer", () => {
    const nodes = [embedder(), indexer()];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];
    const models = [
      makeCatalogModel({ connection_id: CONNECTION_ID, id: MODEL_NAME, dimension: 384 }),
    ];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, models)).toBe(384);
  });

  it("walks back through an intermediate node to find the embedder", () => {
    const chunkGuard: EmbeddingWidthNode = {
      id: "guard-1",
      nodeType: "embedding_guard",
      config: {},
    };
    const nodes = [embedder(), chunkGuard, indexer()];
    const edges: EmbeddingWidthEdge[] = [
      { source: EMBEDDER_ID, target: "guard-1" },
      { source: "guard-1", target: INDEXER_ID },
    ];
    const models = [
      makeCatalogModel({ connection_id: CONNECTION_ID, id: MODEL_NAME, dimension: 768 }),
    ];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, models)).toBe(768);
  });

  it("returns null when no embedder feeds the node", () => {
    const parser: EmbeddingWidthNode = { id: "parser-1", nodeType: "parse.text", config: {} };
    const nodes = [parser, indexer()];
    const edges: EmbeddingWidthEdge[] = [{ source: "parser-1", target: INDEXER_ID }];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, [])).toBeNull();
  });

  it("returns null for a node absent from the graph (e.g. a library preview)", () => {
    expect(resolveExpectedDimension("preview-indexer.pgvector", [], [], [])).toBeNull();
  });

  it("prefers an explicit dimension override on the embedder over the catalog value", () => {
    const nodes = [
      embedder({
        config: { connection_id: CONNECTION_ID, model_name: MODEL_NAME, dimension: 512 },
      }),
      indexer(),
    ];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];
    const models = [
      makeCatalogModel({ connection_id: CONNECTION_ID, id: MODEL_NAME, dimension: 384 }),
    ];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, models)).toBe(512);
  });

  it("returns null when the embedder's model isn't found in the catalog", () => {
    const nodes = [
      embedder({ config: { connection_id: CONNECTION_ID, model_name: "unknown-model" } }),
      indexer(),
    ];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];
    const models = [
      makeCatalogModel({ connection_id: CONNECTION_ID, id: MODEL_NAME, dimension: 384 }),
    ];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, models)).toBeNull();
  });

  it("returns null when the embedder names no connection or model yet", () => {
    const nodes = [embedder({ config: {} }), indexer()];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, [])).toBeNull();
  });

  it("does not loop forever on a cyclic graph", () => {
    const nodeA: EmbeddingWidthNode = { id: "a", nodeType: "router.static", config: {} };
    const nodeB: EmbeddingWidthNode = { id: "b", nodeType: "router.static", config: {} };
    const nodes = [nodeA, nodeB, indexer()];
    const edges: EmbeddingWidthEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
      { source: "b", target: INDEXER_ID },
    ];

    expect(resolveExpectedDimension(INDEXER_ID, nodes, edges, [])).toBeNull();
  });
});

describe("upstreamEmbedderIdentity", () => {
  it("names the connection and model of the embedder feeding the node", () => {
    const nodes = [embedder(), indexer()];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];

    expect(upstreamEmbedderIdentity(INDEXER_ID, nodes, edges)).toEqual({
      connectionId: CONNECTION_ID,
      modelId: MODEL_NAME,
    });
  });

  it("returns null when no embedder is upstream", () => {
    const parser: EmbeddingWidthNode = { id: "parser-1", nodeType: "parse.text", config: {} };
    const nodes = [parser, indexer()];
    const edges: EmbeddingWidthEdge[] = [{ source: "parser-1", target: INDEXER_ID }];

    expect(upstreamEmbedderIdentity(INDEXER_ID, nodes, edges)).toBeNull();
  });

  it("returns null when the embedder carries an explicit dimension override -- nothing left to look up", () => {
    const nodes = [
      embedder({
        config: { connection_id: CONNECTION_ID, model_name: MODEL_NAME, dimension: 512 },
      }),
      indexer(),
    ];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];

    expect(upstreamEmbedderIdentity(INDEXER_ID, nodes, edges)).toBeNull();
  });

  it("returns null when the embedder names no connection or model yet", () => {
    const nodes = [embedder({ config: {} }), indexer()];
    const edges: EmbeddingWidthEdge[] = [{ source: EMBEDDER_ID, target: INDEXER_ID }];

    expect(upstreamEmbedderIdentity(INDEXER_ID, nodes, edges)).toBeNull();
  });
});
