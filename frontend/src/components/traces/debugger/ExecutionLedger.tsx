"use client";

import { AlertTriangle, CircleDot, CircleX } from "lucide-react";
import { useEffect, useRef } from "react";

import { getNodeFamilyStyles, resolveNodeFamily } from "@/components/pipelines/lib/pipeline-theme";
import { formatDuration } from "@/components/traces/debugger/format";
import { journeySentence } from "@/components/traces/lib/journey-sentences";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
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
    <nav aria-label="Execution order" className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <InstrumentLabel>Execution order</InstrumentLabel>
        <Readout label="Nodes" className="ml-auto">
          {sections.reduce((count, section) => count + section.entries.length, 0)}
        </Readout>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sections.map((section) => (
          <section key={section.stage} className="pb-3 last:pb-0">
            <p className="px-2 pb-1">
              <InstrumentLabel className="text-meta">{section.label}</InstrumentLabel>
            </p>
            <ol className="space-y-1">
              {section.entries.map((entry) => {
                const selected = entry.nodeId === selectedNodeId;
                const playing = entry.nodeId === playbackNodeId;
                const failed = entry.step.run?.status === "failed";
                const degraded = entry.step.run?.status === "degraded";
                const family = resolveNodeFamily(entry.step.run?.node_type ?? "");
                const duration = formatDuration(entry.step.run?.duration_ms);
                const effectSentence = entry.itemEffect ? journeySentence(entry.itemEffect) : null;
                const absent = entry.itemEffect?.effect === "absent";
                return (
                  <li key={entry.nodeId}>
                    <button
                      ref={selected ? selectedRef : undefined}
                      type="button"
                      aria-label={`Execution step ${entry.step.run?.node_name ?? entry.nodeId}`}
                      aria-current={selected ? "step" : undefined}
                      onClick={() => onSelectNode(entry.nodeId)}
                      className={cn(
                        "group relative w-full rounded-control border px-2 py-2 text-left transition-colors duration-80 ease-standard",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                        selected
                          ? "border-accent-cyan/55 bg-accent-cyan/10"
                          : "border-transparent hover:border-hairline hover:bg-surface-strong",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {/* A square node dot, coloured by the node's pipeline
                            stage — the row's one piece of meaning-bearing colour.
                            An outcome overrides the stage: what a scanning eye
                            needs from this list is where it went wrong. */}
                        <span
                          aria-hidden
                          className={cn(
                            "h-[7px] w-[7px] shrink-0 rounded-[2px]",
                            failed && "bg-data-neg",
                            degraded && "bg-data-warn",
                            !failed && !degraded && getNodeFamilyStyles(family).accent,
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
                          {entry.step.run?.node_name ?? entry.nodeId}
                        </span>
                        {degraded ? (
                          <Tooltip
                            content="Passed its input through after a provider failure"
                            side="left"
                          >
                            <span
                              role="img"
                              aria-label="Degraded — passed its input through"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-data-warn/40 bg-data-warn/10 text-data-warn"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                            </span>
                          </Tooltip>
                        ) : null}
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
                          <span className="font-mono text-instrument tabular-nums text-meta">
                            {duration}
                          </span>
                        ) : null}
                      </span>
                      {entry.itemEffect && !absent && effectSentence ? (
                        <span className="mt-1 flex items-center gap-2 pl-4 text-instrument text-body">
                          <span className="truncate">{effectSentence}</span>
                          {entry.itemEffect.rank !== null ? (
                            <span className="ml-auto shrink-0 font-mono text-instrument tabular-nums text-accent-cyan">
                              {entry.itemEffect.role === "chunks" ? "Chunk" : "Rank"}{" "}
                              {entry.itemEffect.rank}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </nav>
  );
}
