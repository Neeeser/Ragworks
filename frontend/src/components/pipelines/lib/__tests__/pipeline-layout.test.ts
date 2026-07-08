import { describe, expect, it } from "vitest";

import {
  ESTIMATED_NODE_WIDTH,
  LAYER_GAP_X,
  layoutPipelineNodes,
  needsAutoLayout,
} from "@/components/pipelines/lib/pipeline-layout";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Edge, Node } from "@xyflow/react";

const makeNode = (id: string, position = { x: 0, y: 0 }): Node<PipelineNodeData> => ({
  id,
  type: "pipelineNode",
  position,
  data: {
    label: id,
    nodeType: "parser.document",
    inputs: [],
    outputs: [],
    config: {},
  },
});

const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
});

describe("layoutPipelineNodes", () => {
  it("lays a linear pipeline out as one straight left-to-right row", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [edge("a", "b"), edge("b", "c")];

    const laid = layoutPipelineNodes(nodes, edges);

    const columnWidth = ESTIMATED_NODE_WIDTH + LAYER_GAP_X;
    expect(laid.map((node) => node.position.x)).toEqual([0, columnWidth, columnWidth * 2]);
    // Straight line: every node shares the same vertical position.
    expect(new Set(laid.map((node) => node.position.y)).size).toBe(1);
  });

  it("assigns a node fed by two branches to the column after its deepest input", () => {
    // a -> b -> d and a -> d: d must land after b, not next to it.
    const nodes = [makeNode("a"), makeNode("b"), makeNode("d")];
    const edges = [edge("a", "b"), edge("b", "d"), edge("a", "d")];

    const laid = layoutPipelineNodes(nodes, edges);
    const byId = new Map(laid.map((node) => [node.id, node]));

    expect(byId.get("d")!.position.x).toBeGreaterThan(byId.get("b")!.position.x);
  });

  it("stacks parallel nodes in the same column without overlap", () => {
    const nodes = [makeNode("a"), makeNode("b1"), makeNode("b2")];
    const edges = [edge("a", "b1"), edge("a", "b2")];

    const laid = layoutPipelineNodes(nodes, edges);
    const byId = new Map(laid.map((node) => [node.id, node]));

    expect(byId.get("b1")!.position.x).toBe(byId.get("b2")!.position.x);
    expect(Math.abs(byId.get("b1")!.position.y - byId.get("b2")!.position.y)).toBeGreaterThan(50);
  });
});

describe("needsAutoLayout", () => {
  it("triggers when every node piles up at the origin", () => {
    expect(needsAutoLayout([makeNode("a"), makeNode("b")])).toBe(true);
  });

  it("triggers when saved positions overlap (the old cramped scaffolds)", () => {
    const nodes = [makeNode("a", { x: 0, y: 0 }), makeNode("b", { x: 140, y: 0 })];
    expect(needsAutoLayout(nodes)).toBe(true);
  });

  it("keeps user-arranged positions that do not collide", () => {
    const nodes = [makeNode("a", { x: 0, y: 0 }), makeNode("b", { x: 400, y: 120 })];
    expect(needsAutoLayout(nodes)).toBe(false);
  });

  it("never relayouts a single node", () => {
    expect(needsAutoLayout([makeNode("a")])).toBe(false);
  });
});
