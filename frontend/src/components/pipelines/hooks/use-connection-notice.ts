"use client";

import { useCallback, useMemo, useState } from "react";

import type { ConnectionFeedbackNotice } from "../ConnectionFeedback";
import type { ConnectionFeedback } from "../lib/connection-feedback";

/**
 * The one connection message shown at the drop point, and the two stable
 * callbacks that raise and clear it.
 *
 * Both callbacks keep their identity for the editor's lifetime: the notice
 * runs its own dismiss countdown keyed on the notice, and a handler rebuilt
 * per render would otherwise reach the component as a change worth reacting
 * to on a canvas that re-renders on every graph edit.
 */
export function useConnectionNotice() {
  const [notice, setNotice] = useState<ConnectionFeedbackNotice | null>(null);

  const report = useCallback(
    (feedback: ConnectionFeedback, at: { x: number; y: number } | null) =>
      // Keyed so a repeat of the same refusal restarts its dismiss timer
      // rather than looking like the first one never cleared.
      setNotice((previous) => ({ ...feedback, at, key: (previous?.key ?? 0) + 1 })),
    [],
  );
  const dismiss = useCallback(() => setNotice(null), []);

  return useMemo(() => ({ notice, report, dismiss }), [notice, report, dismiss]);
}
