import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROCESS_MS, useFlowPlayback } from "@/components/pipelines/flow/use-flow-playback";

const steps = [{ nodeIds: ["a"] }, { nodeIds: ["b"] }];
const edges = [{ id: "a-b", source: "a", target: "b" }];
const PROCESS_MS = DEFAULT_PROCESS_MS;
const TRAVEL_MS = 650;

/** Advance one full step: the node processes, then the payload crosses its edge. */
function advanceOneHop() {
  act(() => vi.advanceTimersByTime(PROCESS_MS));
  act(() => vi.advanceTimersByTime(TRAVEL_MS));
}

describe("useFlowPlayback loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("restarts from the first step and keeps playing when loop is set", () => {
    const { result } = renderHook(() =>
      useFlowPlayback({ steps, edges, autoPlay: true, loop: true }),
    );

    advanceOneHop();
    expect(result.current.activeIndex).toBe(1); // reached the last step

    // At the end, one more process window loops back to the start.
    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it("stops at the end when loop is not set", () => {
    const { result } = renderHook(() =>
      useFlowPlayback({ steps, edges, autoPlay: true, loop: false }),
    );

    advanceOneHop();
    expect(result.current.activeIndex).toBe(1);

    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(result.current.playing).toBe(false);
    expect(result.current.activeIndex).toBe(1);
  });
});

describe("useFlowPlayback parallel stages", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const EDGE_CHUNK_EMBED = "chunk-embed";
  const EDGE_CHUNK_BM25 = "chunk-bm25";
  const branchSteps = [
    { nodeIds: ["chunk"] },
    { nodeIds: ["embed", "bm25"] },
    { nodeIds: ["out"] },
  ];
  const branchEdges = [
    { id: EDGE_CHUNK_EMBED, source: "chunk", target: "embed" },
    { id: EDGE_CHUNK_BM25, source: "chunk", target: "bm25" },
    { id: "embed-out", source: "embed", target: "out" },
    { id: "bm25-out", source: "bm25", target: "out" },
  ];

  it("travels every edge into a fan-out stage simultaneously", () => {
    const { result } = renderHook(() =>
      useFlowPlayback({ steps: branchSteps, edges: branchEdges, autoPlay: true }),
    );

    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(result.current.travelingEdgeIds).toEqual(new Set([EDGE_CHUNK_EMBED, EDGE_CHUNK_BM25]));

    act(() => vi.advanceTimersByTime(TRAVEL_MS));
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.travelingEdgeIds).toEqual(new Set());
  });

  it("departs a finished branch's merge edge alongside the other branch's next hop", () => {
    // Asymmetric branches: the top path has two hops (embed → index →
    // collection), the bottom one (bm25 → collection). When the split stage
    // finishes, BOTH departures happen at once — embed's dot to index and
    // bm25's dot straight to the merge — instead of the bottom branch
    // waiting for the top to catch up.
    const asymmetricSteps = [
      { nodeIds: ["chunk"] },
      { nodeIds: ["embed", "bm25"] },
      { nodeIds: ["index"] },
      { nodeIds: ["collection"] },
    ];
    const asymmetricEdges = [
      { id: EDGE_CHUNK_EMBED, source: "chunk", target: "embed" },
      { id: EDGE_CHUNK_BM25, source: "chunk", target: "bm25" },
      { id: "embed-index", source: "embed", target: "index" },
      { id: "bm25-collection", source: "bm25", target: "collection" },
      { id: "index-collection", source: "index", target: "collection" },
    ];
    const { result } = renderHook(() =>
      useFlowPlayback({ steps: asymmetricSteps, edges: asymmetricEdges, autoPlay: true }),
    );

    advanceOneHop(); // chunk → split
    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(result.current.travelingEdgeIds).toEqual(new Set(["embed-index", "bm25-collection"]));

    act(() => vi.advanceTimersByTime(TRAVEL_MS));
    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(result.current.travelingEdgeIds).toEqual(new Set(["index-collection"]));
  });

  it("marks every crossed branch edge as visited after the merge", () => {
    const { result } = renderHook(() =>
      useFlowPlayback({ steps: branchSteps, edges: branchEdges, autoPlay: true }),
    );

    advanceOneHop();
    advanceOneHop();
    expect(result.current.activeIndex).toBe(2);
    expect(result.current.visitedEdgeIds).toEqual(
      new Set([EDGE_CHUNK_EMBED, EDGE_CHUNK_BM25, "embed-out", "bm25-out"]),
    );
  });
});

describe("useFlowPlayback onRunComplete", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once when a non-looping run finishes its last step", () => {
    const onRunComplete = vi.fn();
    renderHook(() => useFlowPlayback({ steps, edges, autoPlay: true, onRunComplete }));

    advanceOneHop();
    expect(onRunComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(onRunComplete).toHaveBeenCalledTimes(1);

    // Nothing further fires once playback has stopped.
    act(() => vi.advanceTimersByTime(PROCESS_MS * 3));
    expect(onRunComplete).toHaveBeenCalledTimes(1);
  });

  it("does not fire when looping past the end", () => {
    const onRunComplete = vi.fn();
    renderHook(() => useFlowPlayback({ steps, edges, autoPlay: true, loop: true, onRunComplete }));

    advanceOneHop();
    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(onRunComplete).not.toHaveBeenCalled();
  });
});

describe("useFlowPlayback initialIndex", () => {
  it("starts playback on the given step instead of the first", () => {
    const { result } = renderHook(() => useFlowPlayback({ steps, edges, initialIndex: 1 }));

    expect(result.current.activeIndex).toBe(1);
    expect(result.current.playing).toBe(false);
  });

  it("clamps an out-of-range initialIndex to the last step", () => {
    const { result } = renderHook(() => useFlowPlayback({ steps, edges, initialIndex: 99 }));

    expect(result.current.activeIndex).toBe(1);
  });
});

describe("useFlowPlayback lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cancels a pending phase when playback is paused", () => {
    const { result } = renderHook(() => useFlowPlayback({ steps, edges, autoPlay: true }));

    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(PROCESS_MS + TRAVEL_MS));

    expect(result.current.activeIndex).toBe(0);
    expect(result.current.phase).toBe("process");
  });

  it("stops and resets a progressed run when autoplay is disabled at runtime", () => {
    const { result, rerender } = renderHook(
      ({ autoPlay }) => useFlowPlayback({ steps, edges, autoPlay }),
      { initialProps: { autoPlay: true } },
    );
    advanceOneHop();
    expect(result.current.activeIndex).toBe(1);

    rerender({ autoPlay: false });

    expect(result.current.activeIndex).toBe(0);
    expect(result.current.phase).toBe("process");
    expect(result.current.playing).toBe(false);
    act(() => vi.advanceTimersByTime(PROCESS_MS + TRAVEL_MS));
    expect(result.current.activeIndex).toBe(0);
  });

  it("does not advance when autoplay is disabled during mount reconciliation", () => {
    const { result, rerender } = renderHook(
      ({ autoPlay }) => useFlowPlayback({ steps, edges, autoPlay }),
      { initialProps: { autoPlay: true } },
    );

    rerender({ autoPlay: false });
    act(() => vi.advanceTimersByTime(PROCESS_MS + TRAVEL_MS));

    expect(result.current.activeIndex).toBe(0);
    expect(result.current.phase).toBe("process");
    expect(result.current.playing).toBe(false);
  });

  it("starts a fresh run when autoplay is enabled at runtime", () => {
    const { result, rerender } = renderHook(
      ({ autoPlay }) => useFlowPlayback({ steps, edges, autoPlay }),
      { initialProps: { autoPlay: false } },
    );

    rerender({ autoPlay: true });

    expect(result.current.activeIndex).toBe(0);
    expect(result.current.playing).toBe(true);
    advanceOneHop();
    expect(result.current.activeIndex).toBe(1);
  });

  it("resumes the final processing step without treating it as completed", () => {
    const { result } = renderHook(() => useFlowPlayback({ steps, edges, autoPlay: true }));
    advanceOneHop();
    act(() => vi.advanceTimersByTime(PROCESS_MS / 2));
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.atEnd).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.playing).toBe(false);
    act(() => result.current.toggle());

    expect(result.current.activeIndex).toBe(1);
    expect(result.current.phase).toBe("process");
    expect(result.current.playing).toBe(true);
  });

  it("replays from the first step after a completed run", () => {
    const { result } = renderHook(() => useFlowPlayback({ steps, edges, autoPlay: true }));
    advanceOneHop();
    act(() => vi.advanceTimersByTime(PROCESS_MS));
    expect(result.current.playing).toBe(false);
    expect(result.current.atEnd).toBe(true);

    act(() => result.current.toggle());

    expect(result.current.activeIndex).toBe(0);
    expect(result.current.phase).toBe("process");
    expect(result.current.playing).toBe(true);
  });

  it("cleans up timers when its consumer unmounts", () => {
    const onRunComplete = vi.fn();
    const { unmount } = renderHook(() =>
      useFlowPlayback({ steps, edges, autoPlay: true, onRunComplete }),
    );

    unmount();
    act(() => vi.runAllTimers());

    expect(onRunComplete).not.toHaveBeenCalled();
  });
});
