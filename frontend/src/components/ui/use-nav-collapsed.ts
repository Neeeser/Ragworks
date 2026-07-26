"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ragworks.nav.collapsed";
/** Below Tailwind's `lg` — the width at which a 184px sidebar stops being free. */
const NARROW_QUERY = "(max-width: 1023px)";

// localStorage as a tiny external store: same-tab writes notify via this set
// (the "storage" event only fires across tabs), so the value is hydration-safe
// without a setState-in-effect. Mirrors use-view-mode.ts.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

function readSnapshot(): boolean {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  // No stored choice: the rail defaults to the icon rail on a narrow screen,
  // where an expanded sidebar takes half the width of a phone on every page,
  // and to labels everywhere else.
  return window.matchMedia(NARROW_QUERY).matches;
}

/**
 * The nav sidebar's collapsed state, persisted per browser.
 *
 * The default is width-dependent — labels at `lg` and up, the icon rail below
 * it — and an explicit toggle wins over both from then on. The server snapshot
 * is the expanded desktop default, so first paint is deterministic and
 * `useSyncExternalStore` reconciles the real value after hydration.
 */
export function useNavCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, readSnapshot, () => false);

  const update = useCallback((next: boolean) => {
    // "0" rather than "" so an explicit expand is distinguishable from never
    // having chosen — otherwise the width default could never apply again.
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    for (const notify of listeners) {
      notify();
    }
  }, []);

  return [collapsed, update];
}
