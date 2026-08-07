"use client";

import { AlertTriangle, Ban } from "lucide-react";
import { useEffect } from "react";

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
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismiss, DISMISS_MS);
    // Any further pointer activity means the user has moved on.
    const clear = () => onDismiss();
    window.addEventListener("pointerdown", clear);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", clear);
    };
  }, [notice, onDismiss]);

  if (!notice) return null;
  const Icon = notice.tone === "warning" ? AlertTriangle : Ban;

  return (
    <div
      role="status"
      // `fixed`, because the drop coordinates are viewport coordinates and the
      // canvas is a transformed ancestor.
      className={cn(
        "card-surface pointer-events-none fixed z-30 flex max-w-[320px] items-start gap-2",
        "bg-canvas-raised px-2.5 py-2 shadow-elevation-2",
        "console-enter",
        notice.at ? "-translate-x-1/2" : "left-1/2 top-20 -translate-x-1/2",
      )}
      style={
        notice.at
          ? // Offset above the pointer so the cursor never covers the text.
            {
              left: notice.at.x,
              top: Math.max(8, notice.at.y - 12),
              transform: "translate(-50%, -100%)",
            }
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
