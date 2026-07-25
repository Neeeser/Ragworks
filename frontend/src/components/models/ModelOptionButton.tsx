"use client";

import { Check } from "lucide-react";

import { Readout } from "@/components/ui/readout";
import { cn } from "@/lib/utils";

import type { CatalogModel } from "@/lib/types";
import type { ReactNode } from "react";

interface ModelOptionButtonProps {
  model: CatalogModel;
  selected: boolean;
  onSelect: (model: CatalogModel) => void;
  /** Secondary line under the name — defaults to the raw model id. */
  subtitle?: ReactNode;
  /** Metadata row (context, pricing, dimensions, modalities) the caller composes. */
  children?: ReactNode;
}

/**
 * The shared selectable model row: name, subtitle, selected highlight, and a
 * caller-supplied metadata row. Every model picker (chat, embedding, reranking,
 * eval generation) renders this shell so a model reads the same everywhere;
 * only the metadata badges differ per catalog kind.
 *
 * Selection reads as an accent fill plus an inset ring — the same mark the nav
 * rail and wizard step list use — with the check icon kept so the state never
 * rests on colour alone. The hover wash is `surface-strong` because the picker
 * also renders inside chat's run-settings pane, which is itself `bg-surface`:
 * a `surface` wash there would be invisible.
 */
export function ModelOptionButton({
  model,
  selected,
  onSelect,
  subtitle,
  children,
}: ModelOptionButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(model)}
      className={cn(
        "w-full rounded-control border px-3 py-2 text-left transition-colors duration-80 ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        selected
          ? "border-accent-violet/40 bg-accent-violet/12 text-primary ring-1 ring-inset ring-accent-violet/30"
          : "border-hairline bg-surface text-body hover:border-strong hover:bg-surface-strong",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-ui font-medium text-primary">{model.name}</span>
          {/* A model id is a literal: rendered verbatim in mono, never through a
              label voice. A caller-supplied subtitle mixes prose and ids, so it
              keeps the meta voice and brings its own mono where it needs it. */}
          <span className="block break-all text-instrument text-meta">
            {subtitle ?? <span className="font-mono">{model.id}</span>}
          </span>
        </span>
        {selected ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-accent-violet" aria-hidden />
        ) : null}
      </span>
      {children}
    </button>
  );
}

interface ModelMetaBadgeProps {
  /** Short caption (e.g. "ctx", "in", "out"). Omit for a bare value. */
  label?: string;
  value: ReactNode;
}

/**
 * One metadata datum in a model row — a `Readout`: sentence-case sans caption
 * plus a mono, tabular value. `font-sans` is forced on the wrapper because
 * callers group these badges inside a `font-mono` row; the value span carries
 * its own `font-mono`, so only the caption is affected.
 */
export function ModelMetaBadge({ label, value }: ModelMetaBadgeProps) {
  if (!label) {
    return <span className="font-mono text-ui tabular-nums text-primary">{value}</span>;
  }
  return (
    <Readout label={label} className="font-sans">
      {value}
    </Readout>
  );
}
