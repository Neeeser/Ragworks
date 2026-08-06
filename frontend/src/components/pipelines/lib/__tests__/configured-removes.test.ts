/**
 * The editor resolves what a node destroys from its config, the way the
 * server does before running the same inference — so an edit that
 * invalidates the stream downstream is reported while it is being made,
 * not on save.
 */

import { describe, expect, it } from "vitest";

import { validatePipelineEdges } from "@/components/pipelines/lib/pipeline-io";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodePort } from "@/lib/types";
import type { Node } from "@xyflow/react";

const itemsPort = (overrides: Partial<NodePort> = {}): NodePort => ({
  key: "items",
  label: "Items",
  data_type: "items",
  required: true,
  accepts_many: false,
  requires: [],
  accepts: [],
  unaccepted: "passthrough",
  adds: [],
  preserves: false,
  removes: [],
  ...overrides,
});

const buildNode = (
  id: string,
  nodeType: string,
  data: Partial<PipelineNodeData>,
): Node<PipelineNodeData> =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: {
      label: nodeType,
      nodeType,
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      config: data.config ?? {},
    },
  }) as Node<PipelineNodeData>;

/** chunks -> embed -> transform -> retriever, where the retriever wants a vector. */
const graph = (transformConfig: Record<string, unknown>) => ({
  nodes: [
    buildNode("chunks", "chunker.token", {
      outputs: [itemsPort({ adds: ["text"] })],
    }),
    buildNode("embed", "embedder.text", {
      inputs: [itemsPort({ accepts: ["text"] })],
      outputs: [itemsPort({ adds: ["embedding"], preserves: true })],
    }),
    buildNode("transform", "llm.transform", {
      inputs: [itemsPort({ accepts: ["text"] })],
      outputs: [itemsPort({ preserves: true })],
      config: transformConfig,
    }),
    buildNode("retrieve", "retriever.vector", {
      inputs: [itemsPort({ requires: ["embedding"] })],
    }),
  ],
  edges: [
    { id: "e0", source: "chunks", target: "embed", sourceHandle: "items", targetHandle: "items" },
    {
      id: "e1",
      source: "embed",
      target: "transform",
      sourceHandle: "items",
      targetHandle: "items",
    },
    {
      id: "e2",
      source: "transform",
      target: "retrieve",
      sourceHandle: "items",
      targetHandle: "items",
    },
  ],
});

describe("config-resolved removes in the editor", () => {
  it("reports the vector as gone once an output field writes the item's text", () => {
    const { nodes, edges } = graph({
      output_fields: [
        { name: "context", type: "string", target: { kind: "text", mode: "prepend" } },
      ],
    });

    const result = validatePipelineEdges(nodes, edges);

    expect(result.edgeErrors["e2"]).toContain("embedding");
  });

  it("leaves the vector alone when the same node only writes metadata", () => {
    const { nodes, edges } = graph({
      output_fields: [
        { name: "author", type: "string", target: { kind: "metadata", key: "author" } },
      ],
    });

    const result = validatePipelineEdges(nodes, edges);

    expect(result.edgeErrors["e2"]).toBeUndefined();
  });
});
