import { humanizeIdentifier } from "@/lib/humanize";
import { cn } from "@/lib/utils";

/**
 * Naming a pipeline parameter in the console.
 *
 * A parameter has two names at once: the label a person reads, and the key the
 * API accepts verbatim. The console renders the label in its sentence-case sans
 * voice and the key as a mono literal beside it, so a first-time user reads a
 * label and a power user still sees exactly what is sent.
 */

/** The key a parameter is sent under, in the console's identifier voice. */
export function ParameterId({ name, className }: { name: string; className?: string }) {
  return <span className={cn("font-mono text-instrument text-meta", className)}>{name}</span>;
}

/** The readable label and its key, paired inline for a control that has no `Field`. */
export function ParameterLabel({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-baseline gap-1", className)}>
      <span className="text-instrument font-medium text-muted">{humanizeIdentifier(name)}</span>
      <ParameterId name={name} />
    </span>
  );
}

/**
 * The accessible name for a parameter's control.
 *
 * Screen readers get both names in one string, because the key is the only part
 * a user can quote back when the request they sent is the thing in question.
 */
export function parameterAccessibleName(name: string): string {
  return `${humanizeIdentifier(name)} (${name})`;
}
