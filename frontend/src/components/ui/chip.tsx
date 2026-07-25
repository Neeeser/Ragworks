import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

/**
 * Colour families a chip may carry. Each one *means* something — a chip's colour
 * is never decoration:
 *
 * - `neutral` — a fact with no state (a version, a count, a mode)
 * - a stage name — the pipeline stage the value belongs to, sharing the editor's
 *   and trace viewer's colour language so the whole product speaks one dialect
 * - `pos`/`warn`/`neg` — semantic status
 */
export type ChipTone =
  | "neutral"
  | "accent"
  | "parse"
  | "chunk"
  | "embed"
  | "index"
  | "retrieve"
  | "chat"
  | "pos"
  | "warn"
  | "neg";

const DOT: Record<ChipTone, string> = {
  neutral: "bg-stage-neutral",
  accent: "bg-accent-violet",
  parse: "bg-stage-parse",
  chunk: "bg-stage-chunk",
  embed: "bg-stage-embed",
  index: "bg-stage-index",
  retrieve: "bg-stage-retrieve",
  chat: "bg-stage-chat",
  pos: "bg-data-pos",
  warn: "bg-data-warn",
  neg: "bg-data-neg",
};

type ChipProps = {
  children: ReactNode;
  tone?: ChipTone;
  /** Hide the dot for a chip that is purely a text fact (a version, an id). */
  dot?: boolean;
  className?: string;
};

/**
 * A compact labelled fact: a pipeline name, a mode, a version, a status.
 *
 * The dot carries the colour and the text stays in an ink token, so the chip is
 * readable without colour discrimination and a row full of chips doesn't turn
 * into a row of competing highlights.
 */
export function Chip({ children, tone = "neutral", dot = true, className }: ChipProps) {
  return (
    // No `title` prop on purpose: a native tooltip cannot be themed, ignores the
    // motion system, and appears after an OS-controlled delay. Wrap the chip in
    // `Tooltip` when it needs explaining.
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-chip border border-hairline px-1.5 py-0.5",
        "font-mono text-instrument uppercase tracking-[0.1em] text-muted",
        className,
      )}
    >
      {dot ? (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
