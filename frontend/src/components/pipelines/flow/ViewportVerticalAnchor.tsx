"use client";

import { useReactFlow, useStore } from "@xyflow/react";
import { useEffect } from "react";

/** Viewport y that puts the anchor node's vertical center at the container's center. */
export const anchoredViewportY = (
  containerHeight: number,
  zoom: number,
  nodeTop: number,
  nodeHeight: number,
) => containerHeight / 2 - (nodeTop + nodeHeight / 2) * zoom;

/**
 * Pins one node's row to the container's vertical center, overriding
 * fitView's bounding-box centering on the y axis only (x and zoom keep the
 * fitted values). fitView centers the whole graph, so a scene that grows a
 * second row shifts its main row — anchoring keeps a designated node (the
 * hero's entry node) at the same screen height across scenes. Reacts to the
 * node's live measured geometry so late measurement (fonts, first paint)
 * can't leave the anchor applied against a stale height.
 */
export function ViewportVerticalAnchor({ nodeId }: Readonly<{ nodeId: string }>) {
  const { getViewport, setViewport } = useReactFlow();
  const containerHeight = useStore((state) => state.height);
  const nodeTop = useStore((state) => state.nodeLookup.get(nodeId)?.position.y ?? 0);
  const nodeHeight = useStore((state) => state.nodeLookup.get(nodeId)?.measured?.height ?? 0);

  useEffect(() => {
    // The anchor node's live measurement is the readiness signal: zero means
    // the node hasn't rendered/measured yet (and this effect re-runs when it
    // does, since the height is a store subscription).
    if (nodeHeight === 0 || containerHeight === 0) return;
    const apply = () => {
      const { x, zoom } = getViewport();
      setViewport({ x, zoom, y: anchoredViewportY(containerHeight, zoom, nodeTop, nodeHeight) });
    };
    apply();
    // Re-apply on the next frame in case ReactFlow's own init-time fitView
    // lands after this effect and overwrites the y we just set.
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [containerHeight, nodeTop, nodeHeight, getViewport, setViewport]);

  return null;
}
