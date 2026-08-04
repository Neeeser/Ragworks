import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

/**
 * Semantic states.
 *
 * - `pos`/`neg`/`warn` — a settled outcome
 * - `active` — work in flight (queued, running, streaming). Cyan is the
 *   console's live-state colour, and the distinction from `warn` is real: a
 *   file being ingested is not a file that needs attention.
 * - `neutral` — "not applicable", never a real state
 */
export type StatusTone = "pos" | "neg" | "warn" | "active" | "neutral";

const DOT: Record<StatusTone, string> = {
  pos: "bg-data-pos shadow-[0_0_8px] shadow-data-pos/50",
  neg: "bg-data-neg",
  warn: "bg-data-warn",
  active: "bg-accent-cyan shadow-[0_0_8px] shadow-accent-cyan/50",
  neutral: "bg-stage-neutral",
};

const TEXT: Record<StatusTone, string> = {
  pos: "text-data-pos",
  neg: "text-data-neg",
  warn: "text-data-warn",
  active: "text-accent-cyan",
  neutral: "text-meta",
};

type StatusDotProps = {
  tone: StatusTone;
  /** Omit for a bare dot inside a row that names the state elsewhere. */
  label?: string;
  /**
   * The state in words, for a bare dot that is the *only* thing carrying it.
   * Domain language ("Covered" / "Not covered"), never the tone — a tone is a
   * palette key, and the same `pos` means "ready", "covered", or "healthy"
   * depending on the row.
   */
  srLabel?: string;
  className?: string;
};

/**
 * A state indicator that never relies on colour alone.
 *
 * The dot is a square node dot (`rounded-[2px]`) — a tiny pipeline node, one of
 * the console's signature marks — with a soft same-colour glow on positive and
 * live states. When `label` is given the text is rendered beside it, so the
 * state is readable without colour discrimination. A bare dot is only correct
 * where the state is already named in the same row.
 *
 * A bare dot is therefore decorative by default: the row that names the state
 * is what a screen reader should read, and a second announcement beside it is
 * noise. Where the dot is the only carrier of the state, the caller passes
 * `srLabel` in its own domain's words.
 */
export function StatusDot({ tone, label, srLabel, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("h-[7px] w-[7px] shrink-0 rounded-[2px]", DOT[tone])} aria-hidden />
      {label ? <InstrumentLabel className={TEXT[tone]}>{label}</InstrumentLabel> : null}
      {!label && srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
}
