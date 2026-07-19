"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FlowTiming } from "./flow-timing";
import type { FlowStep } from "@/components/pipelines/lib/pipeline-playback";

export type PlaybackPhase = "process" | "travel";

/** Default window a node stays highlighted before the payload moves on —
 * with geometry-derived timing this is also the one speed knob: every beam
 * and comet duration scales from the reference card's trip. */
export const DEFAULT_PROCESS_MS = 1250;

type EdgeRef = { id: string; source: string; target: string };

type UseFlowPlaybackParams = {
  steps: FlowStep[];
  edges: EdgeRef[];
  autoPlay?: boolean;
  /** Reference process window: how long the beams take around a typical card. */
  processMs?: number;
  /** Fallback edge-crossing duration for edges without a geometry-derived one. */
  travelMs?: number;
  /**
   * Geometry-derived per-node and per-edge durations (buildFlowTiming). When
   * present, each stage's process window is the slowest of its nodes' beams
   * and each hop lasts as long as its longest edge, so the light moves at one
   * continuous speed across the whole graph.
   */
  timing?: FlowTiming;
  /**
   * When set, playback restarts from the first step after reaching the end
   * instead of stopping -- used for ambient, always-running backdrops.
   */
  loop?: boolean;
  /** Step to start on (clamped to the step range) — e.g. the first failed node. */
  initialIndex?: number;
  /**
   * Fired once when a non-looping run finishes its last step's process
   * window — e.g. the landing page rotating to its next scene.
   */
  onRunComplete?: () => void;
};

export type UseFlowPlaybackResult = {
  activeIndex: number;
  phase: PlaybackPhase;
  playing: boolean;
  /** Edges the payload is currently crossing (travel phase only). */
  travelingEdgeIds: Set<string>;
  /** Edges the payload has already crossed this run. */
  visitedEdgeIds: Set<string>;
  processMs: number;
  travelMs: number;
  /** Geometry-derived per-node beam durations, when timing was provided. */
  processMsByNodeId: ReadonlyMap<string, number> | null;
  /** Comet duration for one edge — geometry-derived, or the travelMs fallback. */
  travelMsForEdge: (edgeId: string) => number;
  atEnd: boolean;
  toggle: () => void;
  stepForward: () => void;
  stepBack: () => void;
  restart: () => void;
  seek: (index: number) => void;
};

const EMPTY_EDGE_SET: Set<string> = new Set();

const clampStepIndex = (index: number, stepCount: number): number =>
  Math.max(0, Math.min(index, stepCount - 1));

/**
 * Timing engine for pipeline playback. Each stage runs two phases -- its
 * nodes "process" (highlighted), then the payload "travels" every edge into
 * the next stage -- so the highlights, the dots, and the step index can never
 * drift apart: they are all views of one (index, phase) state.
 */
export function useFlowPlayback({
  steps,
  edges,
  autoPlay = false,
  processMs = DEFAULT_PROCESS_MS,
  travelMs = 650,
  timing,
  loop = false,
  initialIndex = 0,
  onRunComplete,
}: UseFlowPlaybackParams): UseFlowPlaybackResult {
  const startIndex = clampStepIndex(initialIndex, steps.length);
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [phase, setPhase] = useState<PlaybackPhase>("process");
  const [playing, setPlaying] = useState(autoPlay);
  const [completed, setCompleted] = useState(false);
  const [previousAutoPlay, setPreviousAutoPlay] = useState(autoPlay);

  // autoPlay is presentation policy, so a runtime preference change must
  // take effect before commit. A render-time adjustment prevents the stale
  // autoplay timer from starting during reduced-motion hydration, and lets a
  // later opt-in begin a fresh run.
  if (previousAutoPlay !== autoPlay) {
    setPreviousAutoPlay(autoPlay);
    setActiveIndex(startIndex);
    setPhase("process");
    setCompleted(false);
    setPlaying(autoPlay);
  }
  // Ref so a rerender with a new callback identity can't retrigger the timer.
  const onRunCompleteRef = useRef(onRunComplete);
  useEffect(() => {
    onRunCompleteRef.current = onRunComplete;
  }, [onRunComplete]);

  const edgesBetween = useCallback(
    (fromIndex: number): string[] => {
      const from = steps[fromIndex]?.nodeIds;
      const next = steps[fromIndex + 1]?.nodeIds;
      if (!from || !next) return [];
      const fromSet = new Set(from);
      const nextSet = new Set(next);
      // Every node still ahead of this hop — a payload may travel straight to
      // a merge node several stages downstream (asymmetric branches).
      const downstream = new Set<string>();
      for (let index = fromIndex + 1; index < steps.length; index += 1) {
        for (const nodeId of steps[index].nodeIds) downstream.add(nodeId);
      }
      // An edge departs when its source node finishes this stage (active now,
      // not held into the next stage) and its target lies downstream — so
      // every branch leaving a fan-out departs simultaneously, even when one
      // branch's next node is further away than the other's.
      return edges
        .filter(
          (edge) =>
            fromSet.has(edge.source) && !nextSet.has(edge.source) && downstream.has(edge.target),
        )
        .map((edge) => edge.id);
    },
    [steps, edges],
  );

  const atEnd = completed;

  // A stage's process window is the slowest of its nodes' beam trips, and a
  // hop lasts as long as its longest edge — with geometry-derived timing this
  // is what keeps the light at one continuous speed everywhere.
  const stepProcessMs = useCallback(
    (index: number): number => {
      const nodeIds = steps[index]?.nodeIds ?? [];
      let window = 0;
      for (const nodeId of nodeIds) {
        window = Math.max(window, timing?.processMsByNodeId.get(nodeId) ?? processMs);
      }
      return window || processMs;
    },
    [steps, timing, processMs],
  );

  const travelMsForEdge = useCallback(
    (edgeId: string): number => timing?.travelMsByEdgeId.get(edgeId) ?? travelMs,
    [timing, travelMs],
  );

  const hopTravelMs = useCallback(
    (fromIndex: number): number => {
      let window = 0;
      for (const edgeId of edgesBetween(fromIndex)) {
        window = Math.max(window, travelMsForEdge(edgeId));
      }
      return window || travelMs;
    },
    [edgesBetween, travelMsForEdge, travelMs],
  );

  useEffect(() => {
    if (!playing || steps.length === 0) return;
    if (phase === "process") {
      if (activeIndex >= steps.length - 1) {
        const timer = window.setTimeout(() => {
          if (loop) {
            setActiveIndex(0);
            setPhase("process");
            setCompleted(false);
          } else {
            setCompleted(true);
            setPlaying(false);
            onRunCompleteRef.current?.();
          }
        }, stepProcessMs(activeIndex));
        return () => window.clearTimeout(timer);
      }
      const timer = window.setTimeout(() => {
        setPhase(edgesBetween(activeIndex).length > 0 ? "travel" : "process");
        if (edgesBetween(activeIndex).length === 0) setActiveIndex((prev) => prev + 1);
      }, stepProcessMs(activeIndex));
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setPhase("process");
      setActiveIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }, hopTravelMs(activeIndex));
    return () => window.clearTimeout(timer);
  }, [playing, phase, activeIndex, steps.length, stepProcessMs, hopTravelMs, edgesBetween, loop]);

  const seek = useCallback(
    (index: number) => {
      setActiveIndex(clampStepIndex(index, steps.length));
      setPhase("process");
      setCompleted(false);
    },
    [steps.length],
  );

  const toggle = useCallback(() => {
    if (!playing && atEnd) {
      setActiveIndex(0);
      setPhase("process");
      setCompleted(false);
      setPlaying(true);
      return;
    }
    setPlaying((prev) => !prev);
  }, [atEnd, playing]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    seek(activeIndex + 1);
  }, [activeIndex, seek]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    seek(activeIndex - 1);
  }, [activeIndex, seek]);

  const restart = useCallback(() => {
    setActiveIndex(0);
    setPhase("process");
    setCompleted(false);
    setPlaying(true);
  }, []);

  const travelingEdgeIds = useMemo(
    () => (phase === "travel" ? new Set(edgesBetween(activeIndex)) : EMPTY_EDGE_SET),
    [phase, activeIndex, edgesBetween],
  );

  const visitedEdgeIds = useMemo(() => {
    const visited = new Set<string>();
    for (let index = 0; index < activeIndex; index += 1) {
      for (const id of edgesBetween(index)) visited.add(id);
    }
    return visited;
  }, [activeIndex, edgesBetween]);

  return {
    activeIndex,
    phase,
    playing,
    travelingEdgeIds,
    visitedEdgeIds,
    processMs,
    travelMs,
    processMsByNodeId: timing?.processMsByNodeId ?? null,
    travelMsForEdge,
    atEnd,
    toggle,
    stepForward,
    stepBack,
    restart,
    seek,
  };
}
