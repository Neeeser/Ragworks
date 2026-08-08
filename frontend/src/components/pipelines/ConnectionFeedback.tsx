"use client";

import { AlertTriangle, Ban } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { ConnectionFeedback as Feedback } from "./lib/connection-feedback";

/** Long enough to read two short lines, short enough not to sit over the work. */
const DISMISS_MS = 5000;

export type ConnectionFeedbackNotice = Feedback & {
  /** Viewport coordinates of the drop; null centres it over the canvas. */
  at: { x: number; y: number } | null;
  /** Changes per notice so a repeat of the same refusal restarts the timer. */
  key: number;
};

type ConnectionFeedbackProps = {
  notice: ConnectionFeedbackNotice | null;
  onDismiss: () => void;
};

/**
 * What just happened to a connection, said where the user was looking.
 *
 * At the cursor rather than in the canvas notice bar: a refusal reported at the
 * top of a large canvas is a message beside the pointer's destination, not
 * beside the pointer, and at that distance it reads as unrelated chrome.
 */
export function ConnectionFeedback({ notice, onDismiss }: ConnectionFeedbackProps) {
  // The callback is read through a ref so the countdown depends on the notice
  // alone: an editor re-render between two ticks would otherwise restart the
  // timer, and a canvas that re-renders faster than the dismiss window leaves
  // the message sitting over the work indefinitely.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const noticeKey = notice?.key ?? null;
  useEffect(() => {
    if (noticeKey === null) return;
    const dismiss = () => dismissRef.current();
    const timer = window.setTimeout(dismiss, DISMISS_MS);
    // Any further pointer activity means the user has moved on.
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [noticeKey]);

  if (!notice) return null;
  const Icon = notice.tone === "warning" ? AlertTriangle : Ban;

  return (
    <div
      role="status"
      // `fixed`, because the drop coordinates are viewport coordinates and the
      // canvas is a transformed ancestor.
      className={cn(
        // Above the port tooltip's own z-50: the drop lands on a port, so its
        // tooltip is showing at exactly this spot, and losing the stacking
        // contest hides the message behind the thing it is explaining.
        "card-surface pointer-events-none fixed z-[60] flex max-w-[320px] items-start gap-2",
        "bg-canvas-raised px-2.5 py-2 shadow-elevation-2",
        "console-enter",
        notice.at ? "-translate-x-1/2" : "left-1/2 top-20 -translate-x-1/2",
      )}
      style={
        notice.at
          ? // Below the pointer, because the port tooltip occupies the space
            // above it — stacked, the two read as two messages rather than one
            // over the other.
            { left: notice.at.x, top: notice.at.y + 16, transform: "translateX(-50%)" }
          : undefined
      }
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-px h-3.5 w-3.5 shrink-0",
          notice.tone === "warning" ? "text-data-warn" : "text-data-neg",
        )}
      />
      <div className="min-w-0">
        <p className="text-instrument leading-4 text-primary">{notice.message}</p>
        {notice.fix ? (
          <p className="mt-0.5 text-instrument leading-4 text-muted">{notice.fix}</p>
        ) : null}
      </div>
    </div>
  );
}
