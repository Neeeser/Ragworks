import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

/** Semantic states. `neutral` is for "not applicable", never for a real state. */
export type StatusTone = "pos" | "neg" | "warn" | "neutral";

const DOT: Record<StatusTone, string> = {
  pos: "bg-data-pos",
  neg: "bg-data-neg",
  warn: "bg-data-warn",
  neutral: "bg-stage-neutral",
};

const TEXT: Record<StatusTone, string> = {
  pos: "text-data-pos",
  neg: "text-data-neg",
  warn: "text-data-warn",
  neutral: "text-meta",
};

type StatusDotProps = {
  tone: StatusTone;
  /** Omit for a bare dot inside a row that names the state elsewhere. */
  label?: string;
  className?: string;
};

/**
 * A state indicator that never relies on colour alone.
 *
 * When `label` is given the text is rendered beside the dot, so the state is
 * readable without colour discrimination. A bare dot is only correct where the
 * state is already named in the same row (e.g. a run row whose status column
 * carries the word).
 */
export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
      {label ? <InstrumentLabel className={TEXT[tone]}>{label}</InstrumentLabel> : null}
      {label ? null : <span className="sr-only">{tone}</span>}
    </span>
  );
}
