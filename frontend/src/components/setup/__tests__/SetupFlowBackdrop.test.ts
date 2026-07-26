import { describe, expect, it } from "vitest";

import { focusLiftPx } from "@/components/setup/SetupFlowBackdrop";

const NODE_HEIGHT = 150;

describe("focusLiftPx", () => {
  it("keeps the focused node on screen on a short pane", () => {
    // 720px tall viewport: the unclamped 290px lift put the node band above the
    // top edge, so the backdrop rendered no nodes at all.
    const lift = focusLiftPx(720, NODE_HEIGHT);
    const nodeTop = 720 / 2 - lift - (NODE_HEIGHT * 1.05) / 2;

    expect(lift).toBeLessThan(290);
    expect(nodeTop).toBeGreaterThanOrEqual(0);
  });

  it("keeps the full lift where there is headroom for it", () => {
    expect(focusLiftPx(1080, NODE_HEIGHT)).toBe(290);
  });

  it("never lifts below zero, and falls back before the pane is measured", () => {
    expect(focusLiftPx(200, NODE_HEIGHT)).toBe(0);
    expect(focusLiftPx(0, NODE_HEIGHT)).toBe(290);
  });
});
