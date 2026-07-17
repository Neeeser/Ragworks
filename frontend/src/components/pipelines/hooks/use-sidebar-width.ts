"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ragworks.pipeline-sidebar-width";
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 280;

const clampWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

// localStorage as a tiny external store (the `use-view-mode` pattern):
// hydration-safe without a setState-in-effect. The live value stays in this
// module during a drag; localStorage is written on release.
let widthValue: number | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readSnapshot(): number {
  if (widthValue === null) {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    widthValue = Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : SIDEBAR_DEFAULT_WIDTH;
  }
  return widthValue;
}

function setWidthValue(next: number, persist: boolean): void {
  widthValue = clampWidth(next);
  if (persist) {
    window.localStorage.setItem(STORAGE_KEY, String(widthValue));
  }
  for (const notify of listeners) {
    notify();
  }
}

/**
 * Drag-resizable pipeline sidebar width, persisted per browser (the server
 * renders the default). `startResize` goes on the drag handle's
 * onPointerDown; `resizeBy` backs keyboard resizing.
 */
export function useSidebarWidth() {
  const width = useSyncExternalStore(subscribe, readSnapshot, () => SIDEBAR_DEFAULT_WIDTH);

  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = readSnapshot();
    const onMove = (move: PointerEvent) => {
      setWidthValue(startWidth + (move.clientX - startX), false);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setWidthValue(readSnapshot(), true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const resizeBy = useCallback((delta: number) => {
    setWidthValue(readSnapshot() + delta, true);
  }, []);

  return { width, startResize, resizeBy };
}
