import { describe, expect, it } from "vitest";

import { countHiddenOverrides, resolveNodeSignature } from "../node-signature";
import { buildPipelineConfigFields } from "../pipeline-config";

import type { PipelineConfigField } from "../pipeline-config";

const fieldsFor = (properties: Record<string, unknown>): PipelineConfigField[] =>
  buildPipelineConfigFields({ properties });

describe("resolveNodeSignature", () => {
  it("highlights the embedding model with an optional dimension detail", () => {
    const signature = resolveNodeSignature(
      "embedder.openrouter",
      { model_name: "openai/text-embedding-3-small", dimension: 512 },
      [],
    );
    expect(signature).toMatchObject({
      label: "Model",
      value: "openai/text-embedding-3-small",
      detail: "512 dimensions",
      missing: false,
    });
    expect(signature?.consumedKeys).toEqual(["model_name", "dimension"]);
  });

  it("marks an embedder with no model as missing", () => {
    const signature = resolveNodeSignature("embedder.openrouter", {}, []);
    expect(signature).toMatchObject({ value: "no model selected", missing: true });
  });

  it("falls back to schema defaults when config omits a key", () => {
    const fields = fieldsFor({
      chunk_size: { type: "integer", default: 1024 },
      chunk_overlap: { type: "integer", default: 200 },
    });
    const signature = resolveNodeSignature("chunker.token", {}, fields);
    expect(signature).toMatchObject({
      label: "Chunk size",
      value: "1024",
      detail: "200 overlap",
    });
  });

  it("includes the strategy on the configurable chunker", () => {
    const signature = resolveNodeSignature(
      "chunker.collection",
      { chunk_size: 512, chunk_overlap: 50, strategy: "sentence" },
      [],
    );
    expect(signature).toMatchObject({ value: "512", detail: "50 overlap · sentence" });
  });

  it("shows index/namespace with the backend from config on vector nodes", () => {
    const signature = resolveNodeSignature(
      "indexer.vector",
      { backend: "pgvector", index_name: "rag-prod", namespace: "docs" },
      [],
    );
    expect(signature).toMatchObject({
      label: "Index",
      value: "rag-prod",
      detail: "docs",
      backend: "pgvector",
    });
    expect(signature?.consumedKeys).toContain("backend");
  });

  it("flags a vector node with a blank index as missing", () => {
    const signature = resolveNodeSignature("retriever.vector", { index_name: "" }, []);
    expect(signature).toMatchObject({ value: "no index selected", missing: true });
  });

  it("reads an index named by a binding variable as set per collection", () => {
    const signature = resolveNodeSignature(
      "indexer.vector",
      { backend: { $expr: "primary_index.backend" }, index_name: { $expr: "primary_index.name" } },
      [],
    );

    // The collection's binding supplies this index — the normal shape for a
    // store-bound node, and the opposite of an unset one.
    expect(signature).toMatchObject({
      label: "Index",
      value: "set per collection",
      detail: "primary_index",
    });
    expect(signature?.missing).toBeFalsy();
  });

  it("names the BM25 slot on a lexical node bound to its own variable", () => {
    expect(
      resolveNodeSignature("retriever.bm25", { index_name: { $expr: "bm25_index.name" } }, []),
    ).toMatchObject({ value: "set per collection", detail: "bm25_index" });
  });

  it("still reads as bound when the index expression derives from the collection", () => {
    expect(
      resolveNodeSignature(
        "indexer.pgvector",
        { index_name: { $expr: "'col-' + collection_id" } },
        [],
      ),
    ).toMatchObject({ value: "set per collection", detail: "collection_id" });
  });

  it("pins the backend icon on legacy per-backend node types", () => {
    expect(resolveNodeSignature("retriever.pinecone", { index_name: "x" }, [])).toMatchObject({
      backend: "pinecone",
    });
    expect(resolveNodeSignature("indexer.pgvector", { index_name: "x" }, [])).toMatchObject({
      backend: "pgvector",
    });
  });

  it("shows the provider-backed reranker model without truncation controls", () => {
    const signature = resolveNodeSignature("reranker.model", { model_name: "rerank-v3.5" }, []);
    expect(signature).toMatchObject({
      value: "rerank-v3.5",
      missing: false,
    });
    expect(signature?.consumedKeys).toEqual(["model_name"]);
    expect(resolveNodeSignature("reranker.model", {}, [])).toMatchObject({
      value: "no model selected",
      missing: true,
    });
  });

  it("returns null for nodes with nothing to highlight", () => {
    expect(resolveNodeSignature("ingestion.input", {}, [])).toBeNull();
    expect(resolveNodeSignature("router.file_type", {}, [])).toBeNull();
  });
});

describe("countHiddenOverrides", () => {
  const fields = fieldsFor({
    mode: { type: "string", default: "auto" },
    encoding: { type: "string", default: "utf-8" },
  });

  it("counts only values edited away from their schema default", () => {
    expect(countHiddenOverrides({ encoding: "utf-8" }, fields, ["mode"])).toBe(0);
    expect(countHiddenOverrides({ encoding: "latin-1" }, fields, ["mode"])).toBe(1);
  });

  it("excludes keys the signature readout already shows", () => {
    expect(countHiddenOverrides({ mode: "pdf", encoding: "latin-1" }, fields, ["mode"])).toBe(1);
  });

  it("counts keys with no schema field as overrides", () => {
    expect(countHiddenOverrides({ custom: true }, fields, [])).toBe(1);
  });
});
