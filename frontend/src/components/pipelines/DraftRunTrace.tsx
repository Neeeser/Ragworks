"use client";

import { useMemo } from "react";

import { ExecutionLedger } from "@/components/traces/debugger/ExecutionLedger";
import { useExecutionSelection } from "@/components/traces/debugger/hooks/use-execution-selection";
import { NodeEvidencePanel } from "@/components/traces/debugger/NodeEvidencePanel";
import { buildExecutionSections } from "@/components/traces/lib/execution";
import { buildTraceGraph } from "@/components/traces/trace-graph";

import type { NodeSpec, PipelineTraceResponse } from "@/lib/types";

type DraftRunTraceProps = {
  trace: PipelineTraceResponse;
  nodeSpecs: NodeSpec[];
};

/**
 * A draft run's trace, rendered with the trace debugger's own panes.
 *
 * The ledger and the evidence pane are what answer "what did each step do" —
 * a results list alone would say a query returned five chunks and nothing
 * about which node dropped the sixth. The full-page debugger's graph,
 * playback, and chunk-focus machinery stay out: they navigate and deep-link,
 * and this panel sits over a canvas the user is not leaving.
 */
export function DraftRunTrace({ trace, nodeSpecs }: DraftRunTraceProps) {
  const graph = useMemo(() => buildTraceGraph(trace, null, nodeSpecs), [trace, nodeSpecs]);
  const sections = useMemo(() => buildExecutionSections(graph, null), [graph]);
  const { selectedNodeId, selectedStep, selectNode } = useExecutionSelection(graph, false);
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  );
  const inputSources = useMemo(() => {
    const labelsById = new Map(graph.nodes.map((node) => [node.id, node.data.label]));
    return graph.edges
      .filter((edge) => edge.target === selectedNodeId)
      .map((edge) => labelsById.get(edge.source) ?? edge.source);
  }, [graph.edges, graph.nodes, selectedNodeId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Secondary pane: the ledger navigates, so it takes the surface fill
          on top of the seam and the evidence pane keeps the card. */}
      <div className="max-h-64 min-h-44 shrink-0 border-b border-hairline bg-surface lg:max-h-none lg:min-h-0 lg:w-80 lg:border-b-0 lg:border-r">
        <ExecutionLedger
          sections={sections}
          selectedNodeId={selectedNodeId}
          playbackNodeId={null}
          onSelectNode={selectNode}
        />
      </div>
      <div className="min-h-70 min-w-0 flex-1 lg:min-h-0">
        <NodeEvidencePanel
          key={selectedNodeId}
          step={selectedStep}
          node={selectedNode}
          focusedItemId={null}
          contextItems={[]}
          itemEffect={null}
          inputSources={inputSources}
        />
      </div>
    </div>
  );
}
