"use client";

import { useMemo, useState } from "react";

import {
  formatDuration,
  nodeStatusLabel,
  runStatusTone,
} from "@/components/traces/debugger/format";
import { PortInspector } from "@/components/traces/debugger/PortInspector";
import { NodeExplanation } from "@/components/traces/explanations/NodeExplanation";
import { mergeTraceItems, traceItemsFromRecords } from "@/components/traces/lib/artifacts";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
import { StatusDot } from "@/components/ui/status-dot";
import { TabList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { JourneyStep } from "@/components/traces/lib/journey";
import type { TraceStep } from "@/components/traces/trace-graph";
import type { TabItem } from "@/components/ui/tabs";
import type { TraceFocusedItem } from "@/lib/types";
import type { Node } from "@xyflow/react";

type EvidenceTab = "explanation" | "data" | "configuration" | "raw";

const TABS: Array<TabItem<EvidenceTab>> = [
  { id: "explanation", label: "Explanation" },
  { id: "data", label: "Node data" },
  { id: "configuration", label: "Configuration" },
  { id: "raw", label: "Raw payload" },
];

type NodeEvidencePanelProps = {
  step: TraceStep | null;
  node: Node<PipelineNodeData> | null;
  focusedItemId: string | null;
  contextItems: TraceFocusedItem[];
  itemEffect: JourneyStep | null;
  inputSources: string[];
  onFocusItem?: (itemId: string) => void;
  onOpenArtifact?: (item: TraceFocusedItem) => void;
};

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="overflow-auto whitespace-pre-wrap break-words rounded-panel border border-hairline bg-canvas p-3 font-mono text-instrument leading-relaxed text-body">
    {JSON.stringify(value, null, 2)}
  </pre>
);

/** Stable evidence surface for the selected node. */
export function NodeEvidencePanel({
  step,
  node,
  focusedItemId,
  contextItems,
  itemEffect,
  inputSources,
  onFocusItem,
  onOpenArtifact,
}: NodeEvidencePanelProps) {
  const [tab, setTab] = useState<EvidenceTab>("explanation");
  const run = step?.run ?? null;
  const failed = run?.status === "failed";
  const degraded = run?.status === "degraded";
  const duration = formatDuration(run?.duration_ms);
  const summary = run?.summary ?? { inputs: [], outputs: [] };
  const recordedItems = useMemo(
    () => traceItemsFromRecords([...(step?.io.inputs ?? []), ...(step?.io.outputs ?? [])]),
    [step],
  );
  const availableItems = useMemo(
    () => mergeTraceItems(recordedItems, contextItems),
    [contextItems, recordedItems],
  );

  return (
    <section aria-label="Node evidence" className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-hairline px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="min-w-0 flex-1 truncate text-head font-semibold tracking-[-0.01em] text-primary">
            {run?.node_name ?? node?.data.label ?? step?.nodeId ?? "Node evidence"}
          </h2>
          {run ? (
            <StatusDot tone={runStatusTone(run.status)} label={nodeStatusLabel(run.status)} />
          ) : null}
          {duration ? <Readout label="Duration">{duration}</Readout> : null}
          {step ? <InstrumentLabel className="text-meta">{step.stageLabel}</InstrumentLabel> : null}
        </div>
        <TabList
          tabs={TABS}
          active={tab}
          onSelect={setTab}
          label="Node evidence views"
          wrap
          className="mt-2 justify-start"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
        {/* A degraded node states its failure here too: the node emitted
            something, so the summary below reads like an ordinary result and
            the reason it is not one belongs above it. */}
        {(failed || degraded) && run?.error_message ? (
          <p
            className={cn(
              "mb-3 max-w-[66ch] rounded-control border px-3 py-2 text-ui",
              degraded
                ? "border-data-warn/40 bg-data-warn/10 text-data-warn"
                : "border-data-neg/40 bg-data-neg/10 text-data-neg",
            )}
          >
            {degraded ? `Passed through: ${run.error_message}` : run.error_message}
          </p>
        ) : null}

        {tab === "explanation" && step && node ? (
          <NodeExplanation
            step={step}
            node={node}
            focusedItemId={focusedItemId}
            contextItems={availableItems}
            itemEffect={itemEffect}
            inputSources={inputSources}
            onFocusItem={onFocusItem}
            onOpenArtifact={onOpenArtifact}
          />
        ) : null}

        {tab === "data" ? (
          <PortInspector
            inputs={summary.inputs}
            outputs={summary.outputs}
            io={step?.io ?? { inputs: [], outputs: [] }}
            focusedItemId={focusedItemId}
            contextItems={availableItems}
            onFocusItem={onFocusItem}
            onOpenArtifact={onOpenArtifact}
          />
        ) : null}

        {tab === "configuration" ? <JsonBlock value={node?.data.config ?? {}} /> : null}

        {tab === "raw" ? (
          <JsonBlock
            value={{
              node_id: step?.nodeId ?? null,
              summary,
              io: step?.io ?? { inputs: [], outputs: [] },
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
