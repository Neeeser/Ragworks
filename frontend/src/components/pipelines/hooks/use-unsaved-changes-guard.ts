"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UnsavedChangesGuard {
  /** Run `action` now if clean, otherwise stash it behind the discard prompt. */
  guard: (action: () => void) => void;
  /** True while a stashed action awaits the user's discard decision. */
  confirmOpen: boolean;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

/**
 * Guards every way out of a dirty pipeline editor. While `dirty`:
 * - closing/reloading the tab triggers the native beforeunload dialog;
 * - in-app link navigation is intercepted (capture-phase) and gated behind
 *   the discard prompt, since the App Router has no route-change blocking;
 * - callers wrap their own exits (e.g. switching pipelines) in `guard()`.
 */
export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const router = useRouter();
  // The stashed action lives in a ref (calling it is a side effect, so it must
  // never run inside a state updater); the boolean drives the dialog.
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const stashAction = useCallback((action: () => void) => {
    pendingActionRef.current = action;
    setConfirmOpen(true);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = url.pathname + url.search + url.hash;
      stashAction(() => router.push(destination));
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [dirty, router, stashAction]);

  const guard = useCallback(
    (action: () => void) => {
      if (dirty) {
        stashAction(action);
      } else {
        action();
      }
    },
    [dirty, stashAction],
  );

  const confirmDiscard = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setConfirmOpen(false);
    action?.();
  }, []);

  const cancelDiscard = useCallback(() => {
    pendingActionRef.current = null;
    setConfirmOpen(false);
  }, []);

  return { guard, confirmOpen, confirmDiscard, cancelDiscard };
}
