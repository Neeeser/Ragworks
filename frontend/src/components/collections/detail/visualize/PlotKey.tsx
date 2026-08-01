"use client";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

export type PlotKeyEntry = {
  mark: ReactNode;
  label: string;
};

/**
 * The canvas's key: what each mark means, docked to the plot's inner corner
 * opposite the view controls. A plane where dots, rings, and stars all carry
 * distinct meanings cannot ask the user to hover everything to learn them.
 */
export function PlotKey({ entries, className }: { entries: PlotKeyEntry[]; className?: string }) {
  return (
    <div
      className={cn(
        popoverSurfaceClass,
        "absolute bottom-3 right-3 z-10 flex flex-col gap-1.5 p-2",
        className,
      )}
    >
      {entries.map((entry) => (
        <span key={entry.label} className="flex items-center gap-2">
          <span className="flex w-5 shrink-0 items-center justify-center" aria-hidden>
            {entry.mark}
          </span>
          <span className="text-instrument text-muted">{entry.label}</span>
        </span>
      ))}
    </div>
  );
}

/** A filled chunk dot in a series colour. */
export function ChunkMark() {
  return <span className="h-2 w-2 rounded-full bg-[var(--series-1)]" />;
}

/** The hollow document ring. */
export function DocumentMark() {
  return <span className="h-3 w-3 rounded-full border border-accent-violet/70" />;
}

/** The probe query's filled cyan point. */
export function ProbeMark() {
  return <span className="h-2.5 w-2.5 rounded-full border border-accent-cyan bg-accent-cyan/40" />;
}

/** The cyan halo a probe match wears. */
export function ProbeMatchMark() {
  return <span className="h-3 w-3 rounded-full border border-accent-cyan" />;
}

/** A neutral similarity tie. */
export function TieMark() {
  return <span className="h-0.5 w-4 rounded-full bg-[var(--text-meta)]/60" />;
}

/** A tie carrying confusable chunk pairs. */
export function CollisionTieMark() {
  return <span className="h-0.5 w-4 rounded-full bg-data-neg" />;
}
