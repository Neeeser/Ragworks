"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ragworks.nav.collapsed";

// localStorage as a tiny external store: same-tab writes notify via this set
// (the "storage" event only fires across tabs), so the value is hydration-safe
// without a setState-in-effect. Mirrors use-view-mode.ts.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSnapshot(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

/**
 * The nav sidebar's collapsed state, persisted per browser.
 *
 * Expanded is the default (the server renders it), so first paint always shows
 * the labeled sidebar; a power user who collapses it keeps that choice.
 */
export function useNavCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, readSnapshot, () => false);

  const update = useCallback((next: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "");
    for (const notify of listeners) {
      notify();
    }
  }, []);

  return [collapsed, update];
}
