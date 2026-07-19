import { describe, expect, it } from "vitest";

import { beamPathLength, buildFlowTiming } from "@/components/pipelines/flow/flow-timing";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Node } from "@xyflow/react";

const makeNode = (id: string, x: number, y: number, height: number): Node<PipelineNodeData> => ({
  id,
  type: "pipelineNode",
  position: { x, y },
  measured: { width: 264, height },
  data: { label: id, nodeType: "parser.document", inputs: [], outputs: [], config: {} },
});

describe("buildFlowTiming", () => {
  it("scales every duration to one continuous speed across nodes and edges", () => {
    const short = makeNode("short", 0, 0, 120);
    const tall = makeNode("tall", 400, 0, 360);
    const far = makeNode("far", 1200, 0, 120);
    const edges = [
      { id: "e-near", source: "short", target: "tall" },
      { id: "e-far", source: "tall", target: "far" },
    ];
    const { processMsByNodeId, travelMsByEdgeId } = buildFlowTiming(
      [short, tall, far],
      edges,
      1000,
    );

    // Node windows scale with the beam route length, so a taller card takes
    // proportionally longer at the same speed.
    const shortMs = processMsByNodeId.get("short")!;
    const tallMs = processMsByNodeId.get("tall")!;
    expect(tallMs).toBeGreaterThan(shortMs);
    expect(tallMs / shortMs).toBeCloseTo(beamPathLength(264, 360) / beamPathLength(264, 120), 1);

    // Edge durations scale with distance: the hop covering ~4x the gap takes
    // ~4x as long instead of a faster comet.
    const nearMs = travelMsByEdgeId.get("e-near")!;
    const farMs = travelMsByEdgeId.get("e-far")!;
    // near: 136px gap + 120px midpoint offset; far: 536px gap + 120px offset;
    // both minus the constant 14px handle/corner trim.
    expect(farMs / nearMs).toBeCloseTo((536 + 120 - 14) / (136 + 120 - 14), 1);
  });

  it("skips edges whose endpoints are not in the graph", () => {
    const node = makeNode("only", 0, 0, 120);
    const { travelMsByEdgeId } = buildFlowTiming(
      [node],
      [{ id: "dangling", source: "only", target: "missing" }],
      1000,
    );
    expect(travelMsByEdgeId.has("dangling")).toBe(false);
  });
});
