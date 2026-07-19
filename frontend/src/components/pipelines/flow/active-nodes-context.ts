"use client";

import { createContext, useContext } from "react";

import { DEFAULT_PROCESS_MS } from "./use-flow-playback";

const NO_ACTIVE_NODES: ReadonlySet<string> = new Set();

/**
 * Currently active playback nodes, published by the surface driving playback
 * (FlowPlayer, the setup backdrop) and read by PipelineNode for its active
 * ring and progress beam.
 *
 * Playback surfaces must use this instead of rewriting `data.active` per
 * step: recreating the node objects makes React Flow re-adopt every node,
 * which drops its measured dimensions and hides the entire graph for a frame
 * on each step transition (a visible flash of nodes and edges).
 */
export const ActiveFlowNodesContext = createContext<ReadonlySet<string>>(NO_ACTIVE_NODES);

/** Whether playback currently marks this node active. */
export const useFlowNodeActive = (id: string): boolean =>
  useContext(ActiveFlowNodesContext).has(id);

export type FlowPlaybackTiming = {
  /** Fallback process window for nodes without a geometry-derived duration. */
  processMs: number;
  /** Per-node beam durations from the playback's flow timing — a node's
   * beams round its border in exactly its own window, so the light moves at
   * one continuous speed regardless of card size. */
  processMsByNodeId: ReadonlyMap<string, number> | null;
};

const DEFAULT_TIMING: FlowPlaybackTiming = {
  processMs: DEFAULT_PROCESS_MS,
  processMsByNodeId: null,
};

/**
 * Playback pacing for the node progress beams, published by FlowPlayer from
 * its playback clock. Surfaces without a timed playback (the setup backdrop)
 * fall back to the default duration.
 */
export const FlowPlaybackTimingContext = createContext<FlowPlaybackTiming>(DEFAULT_TIMING);

export const useFlowPlaybackTiming = (): FlowPlaybackTiming =>
  useContext(FlowPlaybackTimingContext);
