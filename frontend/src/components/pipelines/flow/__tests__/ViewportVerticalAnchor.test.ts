import { describe, expect, it } from "vitest";

import { anchoredViewportY } from "@/components/pipelines/flow/ViewportVerticalAnchor";

describe("anchoredViewportY", () => {
  // The invariant the landing hero depends on: whatever the anchor node's
  // flow-space position or the fitted zoom, its projected screen center
  // lands at the container's vertical center — so the entry node stays at
  // the same height when scenes with different row counts rotate through.
  it("projects the anchor node's center onto the container center at any zoom", () => {
    const containerHeight = 900;
    const cases = [
      { zoom: 1, nodeTop: 0, nodeHeight: 92 },
      { zoom: 0.62, nodeTop: 106, nodeHeight: 92 },
      { zoom: 0.4, nodeTop: 212, nodeHeight: 156 },
    ];
    cases.forEach(({ zoom, nodeTop, nodeHeight }) => {
      const viewportY = anchoredViewportY(containerHeight, zoom, nodeTop, nodeHeight);
      const screenCenter = (nodeTop + nodeHeight / 2) * zoom + viewportY;
      expect(screenCenter).toBeCloseTo(containerHeight / 2);
    });
  });
});
