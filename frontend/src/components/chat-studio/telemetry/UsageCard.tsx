"use client";

import { Button } from "@/components/ui/button";

import type { UsageBreakdown } from "@/lib/types";

const usageMetrics: { key: keyof UsageBreakdown; label: string }[] = [
  { key: "prompt_tokens", label: "Prompt tokens" },
  { key: "completion_tokens", label: "Completion tokens" },
  { key: "total_tokens", label: "Total tokens" },
  { key: "reasoning_tokens", label: "Reasoning tokens" },
];

interface UsageCardProps {
  usage: UsageBreakdown | null;
  contextWindow: number;
  contextConsumed: number;
  onExport: () => void;
}

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
    <div className="space-y-3 text-sm text-body">
      <div className="space-y-1 font-mono text-xs uppercase tracking-[0.3em] text-muted">
        <span>Usage window</span>
        <span className="block text-sm normal-case tracking-normal text-body">
          {usageDescription}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-strong">
        <div
          className="h-full rounded-full bg-accent-violet"
          style={{ width: `${contextUtilization}%` }}
        />
      </div>
      <div className="space-y-3">
        <div className="rounded-2xl border border-hairline bg-surface p-3 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            Provider total cost
          </p>
          <p className="mt-2 text-2xl font-semibold text-primary">{usageCostLabel}</p>
          <p className="text-[11px] text-meta">API cost for this session</p>
        </div>
        {usageMetrics.map((metric) => {
          const metricValue = usage?.[metric.key];
          const formattedValue = metricValue != null ? metricValue.toLocaleString() : "—";
          return (
            <div
              key={`${metric.key}`}
              className="rounded-2xl border border-hairline bg-surface p-3 text-center"
            >
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">
                {metric.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-primary">{formattedValue}</p>
            </div>
          );
        })}
      </div>
      <div className="pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-hairline px-3 py-2 text-sm font-semibold text-body hover:border-strong hover:text-primary"
          onClick={onExport}
          title="Exports the full chat messages array as formatted JSON"
        >
          Export chat history
        </Button>
      </div>
    </div>
  );
};
