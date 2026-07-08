"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type FlowStep = {
  nodeId: string;
};

export type PlaybackPhase = "process" | "travel";

type EdgeRef = { id: string; source: string; target: string };

type UseFlowPlaybackParams = {
  steps: FlowStep[];
  edges: EdgeRef[];
  autoPlay?: boolean;
  /** How long a node stays highlighted before the payload moves on. */
  processMs?: number;
  /** How long the payload dot takes to cross an edge. */
  travelMs?: number;
};

export type UseFlowPlaybackResult = {
  activeIndex: number;
  phase: PlaybackPhase;
  playing: boolean;
  /** Edge the payload is currently crossing (travel phase only). */
  travelingEdgeId: string | null;
  /** Edges the payload has already crossed this run. */
  visitedEdgeIds: Set<string>;
  travelMs: number;
  atEnd: boolean;
  toggle: () => void;
  stepForward: () => void;
  stepBack: () => void;
  restart: () => void;
  seek: (index: number) => void;
};

/**
 * Timing engine for pipeline playback. Each step runs two phases -- the node
 * "processes" (highlighted), then the payload "travels" the edge to the next
 * step -- so the highlight, the dot, and the step index can never drift apart:
 * they are all views of one (index, phase) state.
 */
export function useFlowPlayback({
  steps,
  edges,
  autoPlay = false,
  processMs = 1000,
  travelMs = 650,
}: UseFlowPlaybackParams): UseFlowPlaybackResult {
  const [activeIndex, setActiveIndex] = useState(0);
  const [phase, setPhase] = useState<PlaybackPhase>("process");
  const [playing, setPlaying] = useState(autoPlay);

  const edgeBetween = useCallback(
    (fromIndex: number) => {
      const from = steps[fromIndex]?.nodeId;
      const to = steps[fromIndex + 1]?.nodeId;
      if (!from || !to) return null;
      return edges.find((edge) => edge.source === from && edge.target === to)?.id ?? null;
    },
    [steps, edges],
  );

  const atEnd = activeIndex >= steps.length - 1 && phase === "process";

  useEffect(() => {
    if (!playing || steps.length === 0) return;
    if (phase === "process") {
      if (activeIndex >= steps.length - 1) {
        const timer = window.setTimeout(() => setPlaying(false), processMs);
        return () => window.clearTimeout(timer);
      }
      const timer = window.setTimeout(() => {
        setPhase(edgeBetween(activeIndex) ? "travel" : "process");
        if (!edgeBetween(activeIndex)) setActiveIndex((prev) => prev + 1);
      }, processMs);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setPhase("process");
      setActiveIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }, travelMs);
    return () => window.clearTimeout(timer);
  }, [playing, phase, activeIndex, steps.length, processMs, travelMs, edgeBetween]);

  const seek = useCallback(
    (index: number) => {
      setActiveIndex(Math.max(0, Math.min(index, steps.length - 1)));
      setPhase("process");
    },
    [steps.length],
  );

  const toggle = useCallback(() => {
    setPlaying((prev) => {
      if (!prev && atEnd) {
        setActiveIndex(0);
        setPhase("process");
      }
      return !prev;
    });
  }, [atEnd]);

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
    setPlaying(true);
  }, []);

  const travelingEdgeId = phase === "travel" ? edgeBetween(activeIndex) : null;

  const visitedEdgeIds = useMemo(() => {
    const visited = new Set<string>();
    for (let index = 0; index < activeIndex; index += 1) {
      const id = edgeBetween(index);
      if (id) visited.add(id);
    }
    return visited;
  }, [activeIndex, edgeBetween]);

  return {
    activeIndex,
    phase,
    playing,
    travelingEdgeId,
    visitedEdgeIds,
    travelMs,
    atEnd,
    toggle,
    stepForward,
    stepBack,
    restart,
    seek,
  };
}
