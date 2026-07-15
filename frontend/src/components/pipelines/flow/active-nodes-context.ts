"use client";

import { createContext, useContext } from "react";

const NO_ACTIVE_NODES: ReadonlySet<string> = new Set();

/**
 * Currently active playback nodes, published by the surface driving playback
 * (FlowPlayer, the setup backdrop) and read by PipelineNode for its active
 * ring.
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
