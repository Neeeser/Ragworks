"use client";

import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

import type { JourneyStep } from "@/components/traces/lib/journey";

type RankPathProps = {
  steps: JourneyStep[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

const scoreText = (score: number): string =>
  Math.abs(score) >= 10 ? score.toFixed(3) : score.toFixed(4);

/** Focused result ranks across every item-capable retrieval node, in execution order. */
export function RankPath({ steps, selectedNodeId, onSelectNode }: RankPathProps) {
  if (!steps.length) return null;

  return (
    <nav
      aria-label="Rank path"
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-hairline bg-canvas px-4 py-2"
    >
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-meta">
        Rank path
      </span>
      {steps.map((step, index) => {
        const score = step.score === null ? null : scoreText(step.score);
        const scoreLabel = score ? `, score ${score}` : "";
        const label = `View ${step.nodeName} evidence: rank ${step.rank}${scoreLabel}`;
        return (
          <span key={step.nodeId} className="flex shrink-0 items-center gap-2">
            {index > 0 ? <ArrowRight className="h-3 w-3 text-faint" aria-hidden /> : null}
            <button
              type="button"
              aria-label={label}
              aria-current={step.nodeId === selectedNodeId ? "step" : undefined}
              onClick={() => onSelectNode(step.nodeId)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-left transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                step.nodeId === selectedNodeId
                  ? "border-accent-cyan/55 bg-accent-cyan/10"
                  : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
              )}
            >
              <span className="text-[11px] font-medium text-primary">{step.nodeName}</span>
              <span className="ml-2 font-mono text-[10px] text-accent-cyan">
                #{step.rank}
                {score ? ` · ${score}` : ""}
              </span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
