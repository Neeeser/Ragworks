"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useMemo, useState } from "react";

import { hydrateTextValue } from "@/components/traces/lib/artifacts";
import { TraceValueView } from "@/components/traces/values/TraceValueView";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { TraceIOGroup } from "@/components/traces/trace-graph";
import type { PipelineNodeSummaryValue, TraceFocusedItem } from "@/lib/types";

type PortInspectorProps = {
  inputs: PipelineNodeSummaryValue[];
  outputs: PipelineNodeSummaryValue[];
  io: TraceIOGroup;
  focusedItemId?: string | null;
  contextItems: TraceFocusedItem[];
  onFocusItem?: (itemId: string) => void;
  onOpenArtifact?: (item: TraceFocusedItem) => void;
};

type PortEntry = {
  id: string;
  side: "input" | "output";
  item: PipelineNodeSummaryValue;
};

const SIDE_LABEL: Record<PortEntry["side"], string> = { input: "Inputs", output: "Outputs" };
const SIDE_INK: Record<PortEntry["side"], string> = {
  input: "text-accent-cyan",
  output: "text-accent-violet",
};

const visibleEntries = (side: PortEntry["side"], items: PipelineNodeSummaryValue[]): PortEntry[] =>
  items.flatMap((item, index) =>
    item.kind === "items" || item.kind === "ranking"
      ? []
      : [{ id: `${side}-${index}`, side, item }],
  );

const valueType = (item: PipelineNodeSummaryValue): string => item.kind ?? "json";

/** One-at-a-time typed inspection for a node's summarized inputs and outputs. */
export function PortInspector({
  inputs,
  outputs,
  io,
  focusedItemId,
  contextItems,
  onFocusItem,
  onOpenArtifact,
}: PortInspectorProps) {
  const entries = useMemo(
    () => [...visibleEntries("input", inputs), ...visibleEntries("output", outputs)],
    [inputs, outputs],
  );
  const defaultId = entries.find((entry) => entry.side === "output")?.id ?? entries[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const contextById = useMemo(
    () => new Map(contextItems.map((item) => [item.id, item])),
    [contextItems],
  );

  if (!selected) {
    return <p className="text-ui text-muted">No summarized node data was recorded.</p>;
  }

  return (
    <div className="grid min-h-72 overflow-hidden rounded-panel border border-hairline md:grid-cols-[13rem_minmax(0,1fr)]">
      {/* Secondary pane: the field list navigates, so it takes the surface
          fill and the value pane keeps the card's own material. */}
      <nav
        aria-label="Node data fields"
        className="border-b border-hairline bg-surface p-2 md:border-b-0 md:border-r"
      >
        {(["input", "output"] as const).map((side) => {
          const group = entries.filter((entry) => entry.side === side);
          if (!group.length) return null;
          const Icon = side === "input" ? ArrowDownToLine : ArrowUpFromLine;
          return (
            <div key={side} className="mb-3 last:mb-0">
              <p className="px-2 pb-1">
                <InstrumentLabel className={SIDE_INK[side]}>{SIDE_LABEL[side]}</InstrumentLabel>
              </p>
              <div className="space-y-1">
                {group.map((entry) => {
                  const active = entry.id === selected.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-label={`${side === "input" ? "Input" : "Output"} ${entry.item.label}`}
                      aria-pressed={active}
                      onClick={() => setSelectedId(entry.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-control border px-2 py-2 text-left transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                        active
                          ? "border-strong bg-surface-strong text-primary"
                          : "border-transparent text-muted hover:border-hairline hover:bg-surface-strong",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-ui">{entry.item.label}</span>
                      <span className="font-mono text-instrument text-meta">
                        {valueType(entry.item)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <section aria-label={`${selected.item.label} value`} className="min-w-0 p-3">
        <div className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-hairline pb-2">
          <h3 className="text-ui font-medium text-primary">{selected.item.label}</h3>
          <InstrumentLabel className={SIDE_INK[selected.side]}>
            {selected.side === "input" ? "Input" : "Output"}
          </InstrumentLabel>
          <span className="ml-auto font-mono text-instrument text-meta">
            {valueType(selected.item)}
          </span>
        </div>
        <TraceValueView
          value={
            selected.item.kind === "text"
              ? hydrateTextValue(
                  selected.item.value,
                  selected.side === "input" ? io.inputs : io.outputs,
                )
              : selected.item.value
          }
          kind={selected.item.kind ?? "json"}
          focusedItemId={focusedItemId}
          onFocusItem={onFocusItem}
          onOpenItem={
            onOpenArtifact
              ? (itemId) => {
                  const item = contextById.get(itemId);
                  if (item) onOpenArtifact(item);
                }
              : undefined
          }
        />
      </section>
    </div>
  );
}
