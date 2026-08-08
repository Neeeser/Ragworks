"use client";

import { useReactFlow, useStore } from "@xyflow/react";
import { useEffect } from "react";

/**
 * Refits the camera whenever `fitKey` changes.
 *
 * ReactFlow's `fitView` prop only fits at init, so a surface that swaps the
 * node set under one mounted player (the trace debugger's Ingestion ⇄
 * Retrieval bands) keeps the previous band's viewport and can leave the new
 * nodes off-screen. Refitting is keyed on the caller's own identifier rather
 * than the node list so an unrelated re-render never moves the camera.
 */
export function ViewportRefit({ fitKey, padding }: Readonly<{ fitKey: string; padding: number }>) {
  const { fitView } = useReactFlow();
  // The measured node count is the readiness signal: fitting before the new
  // band's nodes are measured computes bounds from the old ones.
  const measuredCount = useStore((state) => state.nodeLookup.size);

  useEffect(() => {
    if (measuredCount === 0) return;
    void fitView({ padding, maxZoom: 1 });
  }, [fitKey, measuredCount, padding, fitView]);

  return null;
}
