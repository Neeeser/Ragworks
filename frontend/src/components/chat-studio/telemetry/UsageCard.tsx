"use client";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Meter } from "@/components/ui/meter";
import { Readout } from "@/components/ui/readout";

import type { UsageBreakdown } from "@/lib/types";

const usageMetrics: { key: keyof UsageBreakdown; label: string }[] = [
  { key: "prompt_tokens", label: "Prompt" },
  { key: "completion_tokens", label: "Completion" },
  { key: "total_tokens", label: "Total" },
  { key: "reasoning_tokens", label: "Reasoning" },
];

interface UsageCardProps {
  usage: UsageBreakdown | null;
  contextWindow: number;
  contextConsumed: number;
  onExport: () => void;
}

/** What this session has spent: context against the model's window, tokens by
 *  kind, and the provider's own cost figure. */
export const UsageCard = ({ usage, contextWindow, contextConsumed, onExport }: UsageCardProps) => {
  const usageCostLabel =
    usage?.cost != null
      ? `$${usage.cost.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        })}`
      : "—";

  const usageDescription = contextWindow
    ? `${contextConsumed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
    : `${contextConsumed.toLocaleString()} tokens consumed`;

  const contextUtilization = contextWindow
    ? Math.min(100, Math.round((contextConsumed / contextWindow) * 100))
    : 0;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <InstrumentLabel>Context</InstrumentLabel>
          <span className="font-mono text-instrument tabular-nums text-body">
            {usageDescription}
          </span>
        </div>
        <Meter
          value={contextUtilization / 100}
          fillClassName="bg-accent-violet"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <InstrumentLabel>Provider total cost</InstrumentLabel>
        <p className="mt-0.5 font-mono text-[20px] tabular-nums text-primary">{usageCostLabel}</p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {usageMetrics.map((metric) => {
          const metricValue = usage?.[metric.key];
          return (
            <Readout key={metric.key} label={metric.label}>
              {metricValue != null ? (
                metricValue.toLocaleString()
              ) : (
                <span className="text-muted">—</span>
              )}
            </Readout>
          );
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={onExport}
        aria-label="Export chat history"
      >
        Export chat history
      </Button>
    </div>
  );
};
