"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { containsChunkId } from "@/components/traces/trace-payload-utils";
import { TraceValueView } from "@/components/traces/values/TraceValueView";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { PipelineNodeIOTrace, PipelineNodeSummaryValue } from "@/lib/types";
import type { ReactNode } from "react";

type Tone = "cyan" | "violet";

const TONE_TITLE: Record<Tone, string> = {
  cyan: "text-accent-cyan",
  violet: "text-accent-violet",
};

type VariableRowProps = {
  label: string;
  meta?: string | null;
  defaultOpen?: boolean;
  highlighted?: boolean;
  children: ReactNode;
};

/** One collapsible row of the variables panel: a disclosure button + value body. */
function VariableRow({
  label,
  meta,
  defaultOpen = false,
  highlighted = false,
  children,
}: VariableRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      data-testid={`variable-row-${label}`}
      data-highlighted={highlighted || undefined}
      className={cn(
        "rounded-panel border border-hairline bg-surface",
        highlighted && "border-accent-cyan/70 bg-accent-cyan/10",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-panel px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-meta transition-transform duration-140 ease-standard",
            open && "rotate-90",
          )}
        />
        <InstrumentLabel className="min-w-0 flex-1 truncate">{label}</InstrumentLabel>
        {meta && <span className="shrink-0 font-mono text-instrument text-meta">{meta}</span>}
      </button>
      {open && <div className="border-t border-hairline px-3 py-2">{children}</div>}
    </div>
  );
}

type VariablesTreeProps = {
  title: string;
  tone: Tone;
  summaryItems: PipelineNodeSummaryValue[];
  ioRecords: PipelineNodeIOTrace[];
  focusedItemId?: string | null;
  onFocusItem?: (itemId: string) => void;
  emptySummaryLabel: string;
};

/**
 * IDE-style variables panel for one side (Inputs or Outputs) of the active
 * node: summary values open by default, each port's raw payload one collapsed
 * level deeper — everything inspectable, nothing forced on the reader.
 */
export function VariablesTree({
  title,
  tone,
  summaryItems,
  ioRecords,
  focusedItemId,
  onFocusItem,
  emptySummaryLabel,
}: VariablesTreeProps) {
  const highlights = (value: unknown) =>
    Boolean(focusedItemId) && containsChunkId(value, focusedItemId ?? "");
  const visibleSummaryItems = summaryItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => focusedItemId || item.kind !== "items");

  return (
    <div className="min-w-0 space-y-2">
      <p>
        <InstrumentLabel className={TONE_TITLE[tone]}>{title}</InstrumentLabel>
      </p>
      {visibleSummaryItems.length === 0 && ioRecords.length === 0 ? (
        <p className="text-ui text-muted">{emptySummaryLabel}</p>
      ) : (
        <>
          {visibleSummaryItems.map(({ item, index }) => (
            <VariableRow
              key={`${item.label}-${index}`}
              label={item.label}
              defaultOpen
              highlighted={highlights(item.value)}
            >
              <TraceValueView
                value={item.value}
                kind={item.kind ?? "json"}
                focusedItemId={focusedItemId}
                onFocusItem={onFocusItem}
              />
            </VariableRow>
          ))}
          {ioRecords.map((record) => (
            <VariableRow
              key={`${record.id}-${record.port}`}
              label={record.port}
              meta="raw"
              highlighted={highlights(record.payload)}
            >
              <TraceValueView
                value={record.payload}
                kind="json"
                focusedItemId={focusedItemId}
                onFocusItem={onFocusItem}
              />
            </VariableRow>
          ))}
        </>
      )}
    </div>
  );
}
