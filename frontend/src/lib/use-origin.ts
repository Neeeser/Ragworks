"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: an origin never changes for a loaded document. */
const subscribe = () => () => {};

/**
 * The browser's origin, empty during server rendering.
 *
 * Read through `useSyncExternalStore` rather than a state-plus-effect pair: it
 * gives React an explicit server snapshot, so the value switches to the real
 * origin on hydration without a mismatch and without a render-triggering
 * effect. Callers must tolerate the empty first value.
 */
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
}
