import { describe, expect, it } from "vitest";

import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";

import type { PipelineDefinition } from "@/lib/types";

type GraphEdge = [source: string, target: string];

const definition = (nodeIds: string[], edges: GraphEdge[]): PipelineDefinition => ({
  nodes: nodeIds.map((id) => ({ id, type: `test.${id}`, name: id, config: {} })),
  edges: edges.map(([source, target], index) => ({
    id: `edge-${index}`,
    source,
    target,
  })),
});

const stepIndexByNode = (pipeline: PipelineDefinition) => {
  const steps = buildTopologyPlaybackSteps(pipeline);
  const indexes = new Map<string, number>();
  steps.forEach((step, index) => step.nodeIds.forEach((nodeId) => indexes.set(nodeId, index)));
  return { steps, indexes };
};

const expectValidSchedule = (pipeline: PipelineDefinition) => {
  const { steps, indexes } = stepIndexByNode(pipeline);
  const scheduled = steps.flatMap((step) => step.nodeIds).sort();
  expect(scheduled).toEqual(pipeline.nodes.map((node) => node.id).sort());
  for (const edge of pipeline.edges) {
    expect(indexes.get(edge.source), `${edge.source} before ${edge.target}`).toBeLessThan(
      indexes.get(edge.target)!,
    );
  }
  return { steps, indexes };
};

describe("buildTopologyPlaybackSteps", () => {
  it("schedules a linear pipeline in dependency order", () => {
    const pipeline = definition(
      ["parse", "chunk", "embed"],
      [
        ["parse", "chunk"],
        ["chunk", "embed"],
      ],
    );

    expect(expectValidSchedule(pipeline).steps).toEqual([
      { nodeIds: ["parse"] },
      { nodeIds: ["chunk"] },
      { nodeIds: ["embed"] },
    ]);
  });

  it("runs fan-out branches concurrently", () => {
    const pipeline = definition(
      ["input", "semantic", "lexical"],
      [
        ["input", "semantic"],
        ["input", "lexical"],
      ],
    );

    const { indexes } = expectValidSchedule(pipeline);
    expect(indexes.get("semantic")).toBe(indexes.get("lexical"));
  });

  it("waits for every fan-in predecessor before running a merge", () => {
    const pipeline = definition(
      ["input", "semantic", "lexical", "merge"],
      [
        ["input", "semantic"],
        ["input", "lexical"],
        ["semantic", "merge"],
        ["lexical", "merge"],
      ],
    );

    const { indexes } = expectValidSchedule(pipeline);
    expect(indexes.get("merge")).toBeGreaterThan(indexes.get("semantic")!);
    expect(indexes.get("merge")).toBeGreaterThan(indexes.get("lexical")!);
  });

  it("preserves parallelism through a diamond DAG", () => {
    const pipeline = definition(
      ["root", "left", "right", "merge"],
      [
        ["root", "left"],
        ["root", "right"],
        ["left", "merge"],
        ["right", "merge"],
      ],
    );

    expect(expectValidSchedule(pipeline).steps).toEqual([
      { nodeIds: ["root"] },
      { nodeIds: ["left", "right"] },
      { nodeIds: ["merge"] },
    ]);
  });

  it("lets a shorter branch finish while a deeper branch catches up", () => {
    const pipeline = definition(
      ["root", "short", "long-a", "long-b", "merge"],
      [
        ["root", "short"],
        ["root", "long-a"],
        ["long-a", "long-b"],
        ["short", "merge"],
        ["long-b", "merge"],
      ],
    );

    const { indexes } = expectValidSchedule(pipeline);
    expect(indexes.get("short")).toBe(indexes.get("long-a"));
    expect(indexes.get("merge")).toBeGreaterThan(indexes.get("long-b")!);
  });

  it("handles nested fan-out and convergence", () => {
    const left = "left";
    const leftA = "left-a";
    const leftB = "left-b";
    const leftMerge = "left-merge";
    const pipeline = definition(
      ["root", left, "right", leftA, leftB, leftMerge, "final"],
      [
        ["root", left],
        ["root", "right"],
        [left, leftA],
        [left, leftB],
        [leftA, leftMerge],
        [leftB, leftMerge],
        [leftMerge, "final"],
        ["right", "final"],
      ],
    );

    const { indexes } = expectValidSchedule(pipeline);
    expect(indexes.get(leftA)).toBe(indexes.get(leftB));
    expect(indexes.get(leftMerge)).toBeGreaterThan(indexes.get(leftA)!);
    expect(indexes.get("final")).toBeGreaterThan(indexes.get(leftMerge)!);
  });

  it("starts disconnected components and multiple roots together", () => {
    const pipeline = definition(
      ["a", "b", "x", "y", "z", "standalone"],
      [
        ["a", "b"],
        ["x", "y"],
        ["y", "z"],
      ],
    );

    expect(expectValidSchedule(pipeline).steps).toEqual([
      { nodeIds: ["a", "standalone", "x"] },
      { nodeIds: ["b", "y"] },
      { nodeIds: ["z"] },
    ]);
  });

  it("is invariant to serialized node and edge order", () => {
    const original = definition(
      ["root", "beta", "alpha", "merge"],
      [
        ["root", "beta"],
        ["root", "alpha"],
        ["beta", "merge"],
        ["alpha", "merge"],
      ],
    );
    const permuted: PipelineDefinition = {
      nodes: [...original.nodes].reverse(),
      edges: [original.edges[2], original.edges[0], original.edges[3], original.edges[1]],
    };

    expect(buildTopologyPlaybackSteps(permuted)).toEqual(buildTopologyPlaybackSteps(original));
  });

  it("rejects cyclic graphs with a diagnostic error", () => {
    const pipeline = definition(
      ["a", "b"],
      [
        ["a", "b"],
        ["b", "a"],
      ],
    );

    expect(() => buildTopologyPlaybackSteps(pipeline)).toThrowError(
      "Pipeline playback graph contains a cycle; cyclic or blocked nodes: a, b.",
    );
  });

  it("groups the shipped hybrid ingestion branches and delays shared output", () => {
    const pipeline = buildDefaultDefinition("ingestion", "pgvector", { includeBm25: true });

    const { steps, indexes } = expectValidSchedule(pipeline);
    expect(steps).toContainEqual({ nodeIds: ["embed-chunks", "index-bm25"] });
    expect(indexes.get("ingest-output")).toBeGreaterThan(indexes.get("index-chunks")!);
    expect(indexes.get("ingest-output")).toBeGreaterThan(indexes.get("index-bm25")!);
  });

  it("rejects duplicate node ids", () => {
    const duplicate = definition(["same", "same"], []);

    expect(() => buildTopologyPlaybackSteps(duplicate)).toThrowError(
      'Pipeline playback graph contains duplicate node id "same".',
    );
  });

  it("rejects edges with missing endpoints", () => {
    const missingSource = definition(["known"], [["missing", "known"]]);
    const missingTarget = definition(["known"], [["known", "missing"]]);

    expect(() => buildTopologyPlaybackSteps(missingSource)).toThrowError(
      'Pipeline playback edge "edge-0" references missing source node "missing".',
    );
    expect(() => buildTopologyPlaybackSteps(missingTarget)).toThrowError(
      'Pipeline playback edge "edge-0" references missing target node "missing".',
    );
  });
});
