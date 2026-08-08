import { describe, expect, it } from "vitest";

import {
  nodeConfigChanged,
  registryDimension,
} from "@/components/pipelines/lib/node-config-equality";

import type { VectorIndex } from "@/lib/types";

const indexes: VectorIndex[] = [
  { name: "alpha", backend: "pinecone", dimension: 768 },
  { name: "local", backend: "pgvector", dimension: 384 },
  { name: "lexical", backend: "pgvector", dimension: null, vector_type: "sparse" },
];

const VECTOR_INDEXER = "indexer.vector";

describe("registryDimension", () => {
  it("states the dimension the picker writes for the index a config names", () => {
    expect(
      registryDimension(VECTOR_INDEXER, { backend: "pinecone", index_name: "alpha" }, indexes),
    ).toBe(768);
  });

  it("states one for a retriever too — its picker writes the same field", () => {
    expect(
      registryDimension("retriever.vector", { backend: "pgvector", index_name: "local" }, indexes),
    ).toBe(384);
  });

  it("states none for a BM25 node — sparse indexes are text-scored", () => {
    expect(
      registryDimension("indexer.bm25", { backend: "pgvector", index_name: "lexical" }, indexes),
    ).toBeNull();
  });

  it("states none for a node that is not store-bound", () => {
    expect(registryDimension("chunker.token", { index_name: "alpha" }, indexes)).toBeNull();
  });

  it("states none when the named index is on another backend or unknown", () => {
    expect(
      registryDimension(VECTOR_INDEXER, { backend: "pgvector", index_name: "alpha" }, indexes),
    ).toBeNull();
    expect(
      registryDimension(VECTOR_INDEXER, { backend: "pinecone", index_name: "missing" }, indexes),
    ).toBeNull();
  });

  it("states none when the index comes from a pipeline variable", () => {
    expect(
      registryDimension(
        VECTOR_INDEXER,
        {
          backend: { $expr: "semantic_index.backend" },
          index_name: { $expr: "semantic_index.name" },
        },
        indexes,
      ),
    ).toBeNull();
  });
});

describe("nodeConfigChanged", () => {
  const SAVED = { backend: "pinecone", index_name: "alpha" };

  it("is unchanged for a config nobody touched", () => {
    // The drawer seeds its draft from the saved config, so anything filled in
    // unconditionally would make an untouched node dirty the moment it opens.
    expect(nodeConfigChanged(VECTOR_INDEXER, SAVED, SAVED, indexes)).toBe(false);
  });

  it("is unchanged when a re-pick supplies the dimension the registry already states", () => {
    const draft = { backend: "pinecone", dimension: 768, index_name: "alpha" };
    expect(nodeConfigChanged(VECTOR_INDEXER, draft, SAVED, indexes)).toBe(false);
  });

  it("is changed when the draft drops a dimension the node stored", () => {
    // The registry dimension is only ever added to the saved side. Adding it to
    // the draft as well would make this removal compare equal, and the drawer
    // would close on it without asking.
    const saved = { ...SAVED, dimension: 768 };
    expect(nodeConfigChanged(VECTOR_INDEXER, SAVED, saved, indexes)).toBe(true);
  });

  it("is changed when the draft's dimension is not the one the registry states", () => {
    const draft = { ...SAVED, dimension: 1536 };
    expect(nodeConfigChanged(VECTOR_INDEXER, draft, SAVED, indexes)).toBe(true);
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
