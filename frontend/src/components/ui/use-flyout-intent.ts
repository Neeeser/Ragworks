"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Long enough that crossing the rail doesn't flash every flyout on the way. */
const OPEN_DELAY_MS = 70;
/** Long enough to cross from a rail item into its own flyout. */
const CLOSE_DELAY_MS = 120;

export type FlyoutIntent = {
  /** The sibling whose flyout is open, or `null`. */
  openId: string | null;
  /** Pointer entered a sibling. */
  hoverStart: (id: string) => void;
  /** Pointer left a sibling and its flyout. */
  hoverEnd: () => void;
  /** Focus landed inside a sibling — opens with no delay. */
  focusOpen: (id: string) => void;
  /** Escape, a click-through, or focus leaving the group. */
  close: () => void;
};

/**
 * Which of a set of siblings shows its flyout, with pointer-intent delays.
 *
 * The open delay is what keeps a pointer travelling down the rail from flashing
 * every panel on the way past; once one panel is committed the next opens with
 * no delay, because the user has already declared intent. The close delay covers
 * the moment the pointer crosses out of the trigger and into the panel itself.
 *
 * Keyboard focus bypasses both delays: focus is not ambiguous, so there is
 * nothing to wait for.
 */
export function useFlyoutIntent(): FlyoutIntent {
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A pending timer must not fire into an unmounted component.
  useEffect(() => clear, [clear]);

  const hoverStart = useCallback(
    (id: string) => {
      clear();
      if (openId !== null) {
        setOpenId(id);
        return;
      }
      timer.current = setTimeout(() => setOpenId(id), OPEN_DELAY_MS);
    },
    [clear, openId],
  );

  const hoverEnd = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }, [clear]);

  const focusOpen = useCallback(
    (id: string) => {
      clear();
      setOpenId(id);
    },
    [clear],
  );

  const close = useCallback(() => {
    clear();
    setOpenId(null);
  }, [clear]);

  return { openId, hoverStart, hoverEnd, focusOpen, close };
}
