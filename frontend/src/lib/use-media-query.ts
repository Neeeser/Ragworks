"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribe to a media query the hydration-safe way (mirrors
 * `use-prefers-reduced-motion`). The server snapshot returns `fallback`.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}
