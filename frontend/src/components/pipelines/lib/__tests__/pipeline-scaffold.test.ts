import { describe, expect, it } from "vitest";

import { buildIngestionDefinition } from "@/components/pipelines/lib/pipeline-scaffold";

const MERGE_NODE = "merge-items";
const RESIZE_NODE = "resize-images";
const EMBED_NODE = "embed-chunks";
const CHUNK_NODE = "chunk-document";

describe("buildIngestionDefinition", () => {
  it("keeps the ingestion input undeclared", () => {
    const definition = buildIngestionDefinition("pgvector");
    const input = definition.nodes.find((node) => node.type === "ingestion.input");
    expect(input?.config).toEqual({});
  });

  it("wires the file item from the input straight into Extract Text", () => {
    // The upload enters the graph as an item on the input's `items` port and
    // is consumed by a parse node's `source` port — a scaffold still naming
    // the removed document planes would build an unloadable graph.
    const definition = buildIngestionDefinition("pgvector");
    expect(definition.nodes.map((node) => node.type)).toContain("parse.text");
    const edge = definition.edges.find((entry) => entry.source === "ingest-input");
    expect(edge).toMatchObject({
      target: "parse-text",
      source_port: "items",
      target_port: "source",
    });
  });

  it("fans the image intake out from the input and merges before the shared chain", () => {
    const definition = buildIngestionDefinition("pgvector", {
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
    const definition = buildIngestionDefinition("pgvector", {
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

  it("names each mode's edges for the nodes that intake actually connects", () => {
    // Facet findings quote an edge id back to the user ("Edge '<id>' delivers
    // items without ..."), so an id naming a node the graph does not contain
    // sends them looking for a step that isn't there.
    const images = buildIngestionDefinition("pgvector", { intake: "images" });
    expect(images.edges.find((edge) => edge.target === EMBED_NODE)?.id).toBe(
      `edge-${RESIZE_NODE}-${EMBED_NODE}`,
    );
    expect(images.edges.find((edge) => edge.target === RESIZE_NODE)?.id).toBe(
      `edge-${MERGE_NODE}-${RESIZE_NODE}`,
    );
    expect(images.edges.filter((edge) => edge.id.includes("chunker"))).toEqual([]);

    const merged = buildIngestionDefinition("pgvector", { intake: "text_images" });
    expect(merged.edges.find((edge) => edge.target === CHUNK_NODE)?.id).toBe(
      `edge-${MERGE_NODE}-${CHUNK_NODE}`,
    );
  });

  it("resizes page renders before embedding them, and only in the image-only intake", () => {
    // A page render is larger than any vision model reads, so the image-only
    // scaffold puts the resize between the merged parse branches and the
    // embedder rather than shipping detail the model discards.
    const images = buildIngestionDefinition("pgvector", { intake: "images" });
    expect(images.nodes.map((node) => node.type)).toContain("image.resize");
    expect(
      images.edges.some((edge) => edge.source === RESIZE_NODE && edge.target === EMBED_NODE),
    ).toBe(true);
    expect(
      images.edges.some((edge) => edge.source === MERGE_NODE && edge.target === EMBED_NODE),
    ).toBe(false);

    for (const intake of ["text", "text_images"] as const) {
      const definition = buildIngestionDefinition("pgvector", { intake });
      expect(definition.nodes.map((node) => node.type)).not.toContain("image.resize");
    }
  });
});
