"use client";

import { cn } from "@/lib/utils";

type PresetCardProps = {
  label: string;
  hint: string;
  /** The concrete settings the preset applies, in the card's mono footer. */
  detail: React.ReactNode;
  detailClassName?: string;
  active: boolean;
  onClick: () => void;
};

/** One radio card in a wizard preset row: name, what it does, what it sets. */
export function PresetCard({
  label,
  hint,
  detail,
  detailClassName,
  active,
  onClick,
}: PresetCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-control border p-3 text-left transition-colors duration-80 ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
        active
          ? "border-accent-violet/70 bg-accent-violet/10"
          : "border-hairline bg-surface hover:border-strong",
      )}
    >
      <p className="text-ui font-medium text-primary">{label}</p>
      <p className="mt-0.5 text-instrument leading-4 text-muted">{hint}</p>
      <p className={cn("mt-1 font-mono text-instrument text-meta", detailClassName)}>{detail}</p>
    </button>
  );
}
