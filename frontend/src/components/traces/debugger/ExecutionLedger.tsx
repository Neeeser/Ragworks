"use client";

import { CircleDot, CircleX } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

import { getNodeFamilyStyles, resolveNodeFamily } from "@/components/pipelines/lib/pipeline-theme";
import { formatDuration } from "@/components/traces/debugger/format";
import { journeySentence } from "@/components/traces/lib/journey-sentences";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ExecutionSection } from "@/components/traces/lib/execution";

type ExecutionLedgerProps = {
  sections: ExecutionSection[];
  selectedNodeId: string | null;
  playbackNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

/** Complete node-run order with optional focused-item effects on each row. */
export function ExecutionLedger({
  sections,
  selectedNodeId,
  playbackNodeId,
  onSelectNode,
}: ExecutionLedgerProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, [selectedNodeId]);

  return (
    <nav
      aria-label="Execution order"
      className="flex h-full min-h-0 flex-col border-hairline bg-canvas-raised lg:border-r"
    >
      <div className="flex shrink-0 items-baseline border-b border-hairline px-4 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Execution order
        </h2>
        <span className="ml-auto font-mono text-[10px] text-meta">
          {sections.reduce((count, section) => count + section.entries.length, 0)} nodes
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {sections.map((section) => (
          <section key={section.stage} className="pb-4 last:pb-0">
            <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.26em] text-meta">
              {section.label}
            </p>
            <ol className="space-y-1.5">
              {section.entries.map((entry) => {
                const selected = entry.nodeId === selectedNodeId;
                const playing = entry.nodeId === playbackNodeId;
                const failed = entry.step.run?.status === "failed";
                const family = resolveNodeFamily(entry.step.run?.node_type ?? "");
                const duration = formatDuration(entry.step.run?.duration_ms);
                const effectSentence = entry.itemEffect ? journeySentence(entry.itemEffect) : null;
                const absent = entry.itemEffect?.effect === "absent";
                return (
                  <Fragment key={entry.nodeId}>
                    <li>
                      <button
                        ref={selected ? selectedRef : undefined}
                        type="button"
                        aria-label={`Execution step ${entry.step.run?.node_name ?? entry.nodeId}`}
                        aria-current={selected ? "step" : undefined}
                        onClick={() => onSelectNode(entry.nodeId)}
                        className={cn(
                          "group relative w-full rounded-xl border px-3 py-2.5 text-left transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                          selected
                            ? "border-accent-cyan/55 bg-accent-cyan/10"
                            : "border-transparent hover:border-hairline hover:bg-surface",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              failed ? "bg-data-neg" : getNodeFamilyStyles(family).accent,
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                            {entry.step.run?.node_name ?? entry.nodeId}
                          </span>
                          {absent && effectSentence ? (
                            <Tooltip content={effectSentence} side="left">
                              <span
                                role="img"
                                aria-label={effectSentence}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-data-neg/40 bg-data-neg/10 text-data-neg"
                              >
                                <CircleX className="h-3.5 w-3.5" aria-hidden />
                              </span>
                            </Tooltip>
                          ) : null}
                          {playing ? (
                            <CircleDot
                              className="h-3.5 w-3.5 shrink-0 text-accent-cyan"
                              aria-label="Playback position"
                            />
                          ) : null}
                          {duration ? (
                            <span className="font-mono text-[10px] text-meta">{duration}</span>
                          ) : null}
                        </span>
                        {entry.itemEffect && !absent && effectSentence ? (
                          <span className="mt-1.5 flex items-center gap-2 pl-4 text-xs text-body">
                            <span className="truncate">{effectSentence}</span>
                            {entry.itemEffect.rank !== null ? (
                              <span className="ml-auto shrink-0 font-mono text-[10px] text-accent-cyan">
                                {entry.itemEffect.role === "chunks" ? "Chunk" : "Rank"}{" "}
                                {entry.itemEffect.rank}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </nav>
  );
}
