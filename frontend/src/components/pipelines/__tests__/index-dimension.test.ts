import { describe, expect, it } from "vitest";

import { withRegistryDimension } from "@/components/pipelines/lib/index-dimension";

import type { VectorIndex } from "@/lib/types";

const indexes: VectorIndex[] = [
  { name: "alpha", backend: "pinecone", dimension: 768 },
  { name: "local", backend: "pgvector", dimension: 384 },
  { name: "lexical", backend: "pgvector", dimension: null, vector_type: "sparse" },
];

const VECTOR_INDEXER = "indexer.vector";

describe("withRegistryDimension", () => {
  it("fills the registry dimension for an index the config names without one", () => {
    expect(
      withRegistryDimension(VECTOR_INDEXER, { backend: "pinecone", index_name: "alpha" }, indexes),
    ).toEqual({ backend: "pinecone", index_name: "alpha", dimension: 768 });
  });

  it("leaves an explicit dimension alone, including one the registry disagrees with", () => {
    const config = { backend: "pinecone", index_name: "alpha", dimension: 1536 };
    expect(withRegistryDimension(VECTOR_INDEXER, config, indexes)).toBe(config);
  });

  it("fills nothing for a BM25 node — sparse indexes carry no dimension", () => {
    const config = { backend: "pgvector", index_name: "lexical" };
    expect(withRegistryDimension("indexer.bm25", config, indexes)).toBe(config);
  });

  it("fills nothing for a node that is not store-bound", () => {
    const config = { index_name: "alpha" };
    expect(withRegistryDimension("chunker.token", config, indexes)).toBe(config);
  });

  it("fills nothing when the named index is on another backend or unknown", () => {
    const otherBackend = { backend: "pgvector", index_name: "alpha" };
    expect(withRegistryDimension(VECTOR_INDEXER, otherBackend, indexes)).toBe(otherBackend);
    const unknown = { backend: "pinecone", index_name: "missing" };
    expect(withRegistryDimension(VECTOR_INDEXER, unknown, indexes)).toBe(unknown);
  });

  it("fills nothing when the index comes from a pipeline variable", () => {
    const bound = {
      backend: { $expr: "semantic_index.backend" },
      index_name: { $expr: "semantic_index.name" },
    };
    expect(withRegistryDimension(VECTOR_INDEXER, bound, indexes)).toBe(bound);
  });
});
