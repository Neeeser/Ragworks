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
    // The seed result is retained but signature-guarded: the moved geometry
    // never sees it.
    expect(
      scheduler.getMatchingResult(
        "edge-1",
        snapshotA.nodeSignature,
        snapshotA.edgeSignatures.get("edge-1") as string,
      ),
    ).toBeNull();
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

  it("keeps serving still-valid routes while an identical resubmission is in flight", () => {
    const dispatch = vi.fn();
    const scheduler = new LatestOnlyRoutingScheduler(dispatch);
    const seedInput = input(264);
    const seed = scheduler.submit(seedInput);
    scheduler.complete(seed.version, results("seed"));
    const nodeSignature = seed.nodeSignature;
    const edgeSignature = seed.edgeSignatures.get("edge-1") as string;
    expect(scheduler.getMatchingResult("edge-1", nodeSignature, edgeSignature)).toMatchObject({
      svgPathString: "seed",
    });

    // An edge remount re-registers and resubmits the same geometry. The seed
    // route must keep rendering while the identical snapshot is in flight —
    // dropping it flashes every edge back to its smooth-step fallback.
    const resubmit = scheduler.submit(input(264));
    expect(scheduler.getMatchingResult("edge-1", nodeSignature, edgeSignature)).toMatchObject({
      svgPathString: "seed",
    });

    scheduler.complete(resubmit.version, results("fresh"));
    expect(scheduler.getMatchingResult("edge-1", nodeSignature, edgeSignature)).toMatchObject({
      svgPathString: "fresh",
    });
  });

  it("never serves a retained route to changed geometry", () => {
    const dispatch = vi.fn();
    const scheduler = new LatestOnlyRoutingScheduler(dispatch);
    const seed = scheduler.submit(input(264));
    scheduler.complete(seed.version, results("seed"));

    const moved = scheduler.submit(input(300));
    expect(
      scheduler.getMatchingResult(
        "edge-1",
        moved.nodeSignature,
        moved.edgeSignatures.get("edge-1") as string,
      ),
    ).toBeNull();
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
