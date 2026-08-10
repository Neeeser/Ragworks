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
  | "rerank"
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
  rerank: "bg-stage-rerank",
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

/** Tinted pill fill + label ink per tone. The fill is quiet; the dot is bright. */
const FILL: Record<ChipTone, string> = {
  neutral: "bg-surface text-muted",
  accent: "bg-accent-violet/12 text-accent-violet",
  parse: "bg-stage-parse/12 text-stage-parse",
  chunk: "bg-stage-chunk/12 text-stage-chunk",
  embed: "bg-stage-embed/12 text-stage-embed",
  index: "bg-stage-index/12 text-stage-index",
  retrieve: "bg-stage-retrieve/12 text-stage-retrieve",
  rerank: "bg-stage-rerank/12 text-stage-rerank",
  chat: "bg-stage-chat/12 text-stage-chat",
  pos: "bg-data-pos/12 text-data-pos",
  warn: "bg-data-warn/12 text-data-warn",
  neg: "bg-data-neg/12 text-data-neg",
};

/**
 * A compact labelled fact as a pill: a pipeline name, a mode, a version, a
 * status. Sentence-case sans — never an identifier (a model id or index name
 * renders verbatim in `font-mono`, outside any label voice).
 *
 * The square node dot carries the brightest colour and the label sits on a
 * quiet tinted fill, so a row full of chips doesn't turn into competing
 * highlights and the state stays readable without colour discrimination.
 */
export function Chip({ children, tone = "neutral", dot = true, className }: ChipProps) {
  return (
    // No `title` prop on purpose: a native tooltip cannot be themed, ignores the
    // motion system, and appears after an OS-controlled delay. Wrap the chip in
    // `Tooltip` when it needs explaining.
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5",
        "text-instrument font-medium",
        FILL[tone],
        className,
      )}
    >
      {dot ? (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-[2px]", DOT[tone])} aria-hidden />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
