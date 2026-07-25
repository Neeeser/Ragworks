import { describe, expect, it } from "vitest";

import { cssColorToRgba } from "@/components/collections/detail/visualize/lib/plot-colors";

describe("cssColorToRgba", () => {
  it("parses the hex form palette tokens use", () => {
    expect(cssColorToRgba("#8b5cf6")).toEqual([139, 92, 246, 255]);
    expect(cssColorToRgba("#fff")).toEqual([255, 255, 255, 255]);
  });

  it("keeps an rgba() token's own alpha unless overridden", () => {
    // Hairline tokens carry their alpha in the value; the grid must keep it.
    expect(cssColorToRgba("rgba(167, 139, 250, 0.13)")).toEqual([167, 139, 250, 33]);
    expect(cssColorToRgba("rgb(148, 163, 184)")).toEqual([148, 163, 184, 255]);
  });

  it("applies an explicit alpha override", () => {
    expect(cssColorToRgba("#8b5cf6", 200)).toEqual([139, 92, 246, 200]);
    expect(cssColorToRgba("rgba(167, 139, 250, 0.13)", 90)).toEqual([167, 139, 250, 90]);
  });

  it("returns null for unresolved values so callers keep their fallback", () => {
    // jsdom and the first client render both produce "" for custom properties.
    expect(cssColorToRgba("")).toBeNull();
    expect(cssColorToRgba("oklch(0.7 0.1 300)")).toBeNull();
  });
});
