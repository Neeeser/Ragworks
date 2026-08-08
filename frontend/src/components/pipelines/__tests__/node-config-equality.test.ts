import { describe, expect, it } from "vitest";

import {
  nodeConfigChanged,
  withRegistryDimension,
} from "@/components/pipelines/lib/node-config-equality";

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

  it("fills the registry dimension for a retriever, whose picker writes one too", () => {
    expect(
      withRegistryDimension(
        "retriever.vector",
        { backend: "pgvector", index_name: "local" },
        indexes,
      ),
    ).toEqual({ backend: "pgvector", index_name: "local", dimension: 384 });
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

describe("nodeConfigChanged", () => {
  const SAVED = { backend: "pinecone", index_name: "alpha" };

  it("is unchanged when a re-pick supplies the dimension the registry already states", () => {
    const draft = { backend: "pinecone", dimension: 768, index_name: "alpha" };
    expect(nodeConfigChanged(VECTOR_INDEXER, draft, SAVED, indexes)).toBe(false);
  });

  it("is changed when the draft drops a dimension the node stored", () => {
    // Only the saved side is filled from the registry. Filling the draft too
    // would make this removal compare equal, and the drawer would close on it
    // without asking.
    const saved = { ...SAVED, dimension: 768 };
    expect(nodeConfigChanged(VECTOR_INDEXER, SAVED, saved, indexes)).toBe(true);
  });

  it("is changed when the draft names a different index", () => {
    const draft = { backend: "pgvector", index_name: "local", dimension: 384 };
    expect(nodeConfigChanged(VECTOR_INDEXER, draft, SAVED, indexes)).toBe(true);
  });

  it("ignores key order", () => {
    const saved = { backend: "pinecone", dimension: 768, index_name: "alpha" };
    const draft = { index_name: "alpha", backend: "pinecone", dimension: 768 };
    expect(nodeConfigChanged(VECTOR_INDEXER, draft, saved, indexes)).toBe(false);
  });
});
