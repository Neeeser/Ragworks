"use client";

import { useEffect, useState } from "react";

/**
 * Resolves the concrete color for ReactFlow's `<Background>` dot grid.
 *
 * `<Background color>` is written to the SVG `fill` presentation attribute,
 * where a CSS `var()` reference is invalid -- so we read the hairline token's
 * concrete value off the document root and recompute it whenever the theme
 * flips (the theme provider stamps `data-theme` on `<html>`), keeping the grid
 * theme-aware without hardcoding a hex.
 *
 * Starts `transparent` so the server render and first paint stay deterministic
 * (hydration-safe); the real value is read in a mount effect.
 */
export function useFlowDotColor(): string {
  const [color, setColor] = useState("transparent");

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const value = getComputedStyle(root).getPropertyValue("--border-hairline").trim();
      if (value) setColor(value);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => observer.disconnect();
  }, []);

  return color;
}
