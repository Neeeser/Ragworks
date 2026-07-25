import { cn } from "@/lib/utils";

type PulseWireProps = {
  /** Accessible name for the live process, e.g. "Streaming response". */
  label: string;
  className?: string;
};

/**
 * The pulse — a travelling accent beam on a 2px wire, the console's one
 * expressive motion.
 *
 * Licensed ONLY while data is actually flowing: a streaming response, a
 * running query or eval. Render it while the process runs and unmount it the
 * moment the process stops — an idle pulse is a lie and spends the mark's
 * meaning. No-ops under reduced motion (the track remains as a static
 * indicator).
 */
export function PulseWire({ label, className }: PulseWireProps) {
  return (
    // Both an aria-label AND a visually hidden text node: the status role takes
    // its accessible NAME from the author (aria-label), but a live region only
    // reliably ANNOUNCES its text content — an empty region's label is spoken
    // inconsistently across screen readers.
    <span role="status" aria-label={label} className={cn("pulse-track block w-24", className)}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
