"use client";

import { cn } from "@/lib/utils";

import type { StatsHistoryRange } from "@/lib/types";

const RANGES: Array<{ id: StatsHistoryRange; label: string }> = [
  { id: "4h", label: "4h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

type RangePickerProps = {
  value: StatsHistoryRange;
  onChange: (range: StatsHistoryRange) => void;
};

/** Page-level trailing-window selector; every overview chart follows it. */
export function RangePicker({ value, onChange }: RangePickerProps) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-full border border-hairline p-0.5"
    >
      {RANGES.map((range) => (
        <button
          key={range.id}
          type="button"
          onClick={() => onChange(range.id)}
          aria-pressed={value === range.id}
          className={cn(
            "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            value === range.id
              ? "bg-accent-violet/15 text-primary"
              : "text-muted hover:text-primary",
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
