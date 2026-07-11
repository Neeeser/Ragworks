"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ViewMode = "list" | "grid";

const STORAGE_KEY = "ragworks.files.viewMode";

// localStorage as a tiny external store: same-tab writes notify via this set
// (the "storage" event only fires across tabs), so the value is hydration-safe
// without a setState-in-effect.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSnapshot(): ViewMode {
  return window.localStorage.getItem(STORAGE_KEY) === "grid" ? "grid" : "list";
}

/** The list/grid toggle, persisted per browser (server renders the default). */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, readSnapshot, () => "list" as ViewMode);

  const update = useCallback((next: ViewMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    for (const notify of listeners) {
      notify();
    }
  }, []);

  return [mode, update];
}
