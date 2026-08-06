import { describe, expect, it } from "vitest";

import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";

const MERGE_NODE = "merge-items";
const RESIZE_NODE = "resize-images";
const EMBED_NODE = "embed-chunks";

describe("buildDefaultDefinition", () => {
  it("declares the result_limit input variable, mirroring the backend scaffold", () => {
    // The backend scaffold (app/pipelines/defaults.py) declares result_limit as an
    // input-source variable accepted by retrieval.input, so search controls
    // and the chat tool schema see the same contract; wizard-created
    // pipelines must not silently declare nothing.
    const definition = buildDefaultDefinition("retrieval", "pgvector");
    const input = definition.nodes.find((node) => node.type === "retrieval.input");
    expect(input?.config).toEqual({ arguments: ["result_limit"] });
    expect(definition.variables).toEqual([
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
    ]);
  });

  it("scaffolds the hybrid ranking row: fusion never cuts, Result Limit does", () => {
    const definition = buildDefaultDefinition("retrieval", "pgvector", { includeBm25: true });
    const fusion = definition.nodes.find((node) => node.type === "fusion.rrf");
    const limit = definition.nodes.find((node) => node.type === "limit.results");
    expect(fusion?.config).toEqual({});
    expect(limit?.name).toBe("Result Limit");
    expect(limit?.config).toEqual({ max_results: { $expr: "result_limit" } });
    // Retrievers carry their fetch depth explicitly — no invisible fallback.
    for (const type of ["retriever.vector", "retriever.bm25"]) {
      const retriever = definition.nodes.find((node) => node.type === type);
      expect(retriever?.config).toMatchObject({ top_k: { $expr: "result_limit" } });
    }
    expect(
      definition.edges.some((edge) => edge.source === fusion?.id && edge.target === limit?.id),
    ).toBe(true);
    expect(
      definition.edges.some(
        (edge) => edge.source === limit?.id && edge.target === "retrieval-output",
      ),
    ).toBe(true);
  });

  it("keeps the ingestion input undeclared", () => {
    const definition = buildDefaultDefinition("ingestion", "pgvector");
    const input = definition.nodes.find((node) => node.type === "ingestion.input");
    expect(input?.config).toEqual({});
  });

  it("wires the file item from the input straight into Extract Text", () => {
    // The upload enters the graph as an item on the input's `items` port and
    // is consumed by a parse node's `source` port — a scaffold still naming
    // the removed document planes would build an unloadable graph.
    const definition = buildDefaultDefinition("ingestion", "pgvector");
    expect(definition.nodes.map((node) => node.type)).toContain("parse.text");
    const edge = definition.edges.find((entry) => entry.source === "ingest-input");
    expect(edge).toMatchObject({
      target: "parse-text",
      source_port: "items",
      target_port: "source",
    });
  });

  it("fans the image intake out from the input and merges before the shared chain", () => {
    const definition = buildDefaultDefinition("ingestion", "pgvector", {
      intake: "text_images",
      includeBm25: true,
    });
    const parsers = ["parse.text", "parse.embedded_media", "parse.media_file"];
    expect(definition.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(parsers));
    // Every parse node reads the input directly — one wired behind another
    // would receive no file items at all.
    for (const id of ["parse-text", "parse-embedded-media", "parse-media-file"]) {
      expect(
        definition.edges.some((edge) => edge.source === "ingest-input" && edge.target === id),
      ).toBe(true);
      expect(
        definition.edges.some((edge) => edge.source === id && edge.target === MERGE_NODE),
      ).toBe(true);
    }
    expect(
      definition.edges.some(
        (edge) => edge.source === MERGE_NODE && edge.target === "chunk-document",
      ),
    ).toBe(true);
  });

  it("scaffolds the image-only intake with no chunker and no BM25 branch", () => {
    // Page renders carry no text, so a chunker would pass everything through
    // and a BM25 index would receive nothing to index.
    const definition = buildDefaultDefinition("ingestion", "pgvector", {
      intake: "images",
      includeBm25: true,
    });
    const types = definition.nodes.map((node) => node.type);
    expect(types).toEqual(expect.arrayContaining(["parse.page_images", "parse.media_file"]));
    expect(types).not.toContain("chunker.token");
    expect(types).not.toContain("indexer.bm25");
    expect(
      definition.edges.some((edge) => edge.source === MERGE_NODE && edge.target === RESIZE_NODE),
    ).toBe(true);
  });

  it("resizes page renders before embedding them, and only in the image-only intake", () => {
    // A page render is larger than any vision model reads, so the image-only
    // scaffold puts the resize between the merged parse branches and the
    // embedder rather than shipping detail the model discards.
    const images = buildDefaultDefinition("ingestion", "pgvector", { intake: "images" });
    expect(images.nodes.map((node) => node.type)).toContain("image.resize");
    expect(
      images.edges.some((edge) => edge.source === RESIZE_NODE && edge.target === EMBED_NODE),
    ).toBe(true);
    expect(
      images.edges.some((edge) => edge.source === MERGE_NODE && edge.target === EMBED_NODE),
    ).toBe(false);

    for (const intake of ["text", "text_images"] as const) {
      const definition = buildDefaultDefinition("ingestion", "pgvector", { intake });
      expect(definition.nodes.map((node) => node.type)).not.toContain("image.resize");
    }
  });
});
