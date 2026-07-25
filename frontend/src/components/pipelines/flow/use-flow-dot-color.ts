"use client";

import { useCssTokens } from "@/lib/use-css-tokens";

const DOT_TOKENS = ["--border-hairline"] as const;

/**
 * Resolves the concrete color for ReactFlow's `<Background>` dot grid.
 *
 * `<Background color>` is written to the SVG `fill` presentation attribute,
 * where a CSS `var()` reference is invalid — so the hairline token resolves
 * through `useCssTokens`, the shared computed-style bridge that re-reads on
 * every theme and palette change.
 *
 * Starts `transparent` so the server render and first paint stay deterministic
 * (hydration-safe); the real value lands in the hook's mount effect.
 */
export function useFlowDotColor(): string {
  const [hairline] = useCssTokens(DOT_TOKENS);
  return hairline || "transparent";
}
