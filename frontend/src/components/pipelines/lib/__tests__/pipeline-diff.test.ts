import { describe, expect, it } from "vitest";

import { diffDefinitions, materialChanges } from "@/components/pipelines/lib/pipeline-diff";

import type { PipelineDefinition } from "@/lib/types";

const definition = (): PipelineDefinition => ({
  nodes: [
    {
      id: "a",
      type: "chunker.token",
      name: "Chunker",
      config: { chunk_size: 1024 },
      position: { x: 0, y: 0 },
    },
    {
      id: "b",
      type: "embedder.openrouter",
      name: "Embedder",
      config: {},
      position: { x: 300, y: 0 },
    },
  ],
  edges: [{ id: "e1", source: "a", target: "b", source_port: "chunks", target_port: "chunks" }],
});

describe("diffDefinitions", () => {
  it("returns no changes for identical definitions", () => {
    expect(diffDefinitions(definition(), definition())).toEqual([]);
  });

  it("describes config edits per key with old and new values", () => {
    const next = definition();
    next.nodes[0].config = { chunk_size: 512 };

    const changes = diffDefinitions(definition(), next);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("node_config");
    expect(changes[0].summary).toContain("1024");
    expect(changes[0].summary).toContain("512");
  });

  it("ignores edge ids and matches edges by endpoints", () => {
    const next = definition();
    next.edges[0].id = "regenerated-client-id";

    expect(diffDefinitions(definition(), next)).toEqual([]);
  });

  it("reports adds, removals, renames, and connections", () => {
    const next = definition();
    next.nodes[1].name = "Query Embedder";
    next.nodes.push({ id: "c", type: "retrieval.output", name: "Out", config: {} });
    next.edges.push({ id: "e2", source: "b", target: "c" });

    const kinds = new Set(diffDefinitions(definition(), next).map((change) => change.kind));

    expect(kinds).toEqual(new Set(["node_added", "node_renamed", "edge_added"]));
  });

  it("collapses position moves into a single non-material layout change", () => {
    const next = definition();
    next.nodes[0].position = { x: 50, y: 80 };
    next.nodes[1].position = { x: 500, y: 80 };

    const changes = diffDefinitions(definition(), next);

    expect(changes).toEqual([{ kind: "layout", summary: "Layout updated" }]);
    expect(materialChanges(changes)).toEqual([]);
  });
});
