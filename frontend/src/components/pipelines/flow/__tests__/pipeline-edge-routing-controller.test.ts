import { Position } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { LatestOnlyRoutingScheduler } from "../pipeline-edge-routing-controller";

import type {
  BatchEdgeInput,
  BatchRoutingInput,
  BatchRoutingResults,
} from "@tisoap/react-flow-smart-edge";

const edge = (sourceX: number): BatchEdgeInput => ({
  id: "edge-1",
  source: "source",
  target: "target",
  sourceX,
  sourceY: 74,
  targetX: 736,
  targetY: 74,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  preset: "smoothstep",
});

const input = (sourceX: number): BatchRoutingInput => ({
  nodes: [
    {
      id: "source",
      position: { x: sourceX - 264, y: 0 },
      measured: { width: 264, height: 92 },
      data: {},
    },
    { id: "target", position: { x: 736, y: 0 }, measured: { width: 264, height: 92 }, data: {} },
  ],
  edges: [edge(sourceX)],
});

const results = (path: string): BatchRoutingResults => ({
  "edge-1": {
    svgPathString: path,
    edgeCenterX: 500,
    edgeCenterY: 74,
    points: [],
  },
});

describe("LatestOnlyRoutingScheduler", () => {
  it("clears stale routes and dispatches only the oldest and newest rapid snapshots", () => {
    const dispatch = vi.fn();
    const scheduler = new LatestOnlyRoutingScheduler(dispatch);
    const seed = scheduler.submit(input(264));
    scheduler.complete(seed.version, results("seed"));
    expect(scheduler.getResult("edge-1", seed.version)).toMatchObject({ svgPathString: "seed" });
    dispatch.mockClear();

    const snapshotA = scheduler.submit(input(274));
    expect(scheduler.getResult("edge-1", seed.version)).toBeNull();
    const snapshotB = scheduler.submit(input(284));
    const snapshotC = scheduler.submit(input(294));

    expect(dispatch.mock.calls.map(([snapshot]) => snapshot.version)).toEqual([snapshotA.version]);
    scheduler.complete(snapshotA.version, results("stale-a"));
    expect(scheduler.getResult("edge-1", snapshotC.version)).toBeNull();
    expect(dispatch.mock.calls.map(([snapshot]) => snapshot.version)).toEqual([
      snapshotA.version,
      snapshotC.version,
    ]);
    expect(dispatch.mock.calls.map(([snapshot]) => snapshot.version)).not.toContain(
      snapshotB.version,
    );

    scheduler.complete(snapshotA.version, results("late-a"));
    expect(scheduler.getResult("edge-1", snapshotC.version)).toBeNull();
    scheduler.complete(snapshotC.version, results("current-c"));
    expect(scheduler.getResult("edge-1", snapshotC.version)).toMatchObject({
      svgPathString: "current-c",
    });
  });

  it("keeps the fallback clear when the latest dispatch fails", () => {
    const dispatch = vi.fn();
    const scheduler = new LatestOnlyRoutingScheduler(dispatch);
    const snapshot = scheduler.submit(input(264));

    scheduler.fail(snapshot.version);

    expect(scheduler.getResult("edge-1", snapshot.version)).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(2);
    scheduler.complete(snapshot.version, {});
    expect(scheduler.getResult("edge-1", snapshot.version)).toBeNull();
  });
});
