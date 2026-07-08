"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { layoutPipelineNodes, needsAutoLayout } from "@/components/pipelines/lib/pipeline-layout";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import { TraceIOColumn } from "@/components/traces/TraceIOColumn";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";
import { fetchPipelineNodes } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { NodeSpec, PipelineNodeIOTrace, PipelineTraceResponse } from "@/lib/types";
import type { Node } from "@xyflow/react";

type PipelineTraceViewerProps = {
  trace: PipelineTraceResponse | null;
  /** Optional explicit token; falls back to the signed-in user's token when omitted. */
  token?: string;
  /** When provided, skips the internal node-spec fetch and uses these instead. */
  nodeSpecs?: NodeSpec[];
  isOpen: boolean;
  onClose: () => void;
  highlightChunkId?: string | null;
};

type IOGroup = {
  inputs: PipelineNodeIOTrace[];
  outputs: PipelineNodeIOTrace[];
};

export function PipelineTraceViewer({
  trace,
  token,
  nodeSpecs: providedNodeSpecs,
  isOpen,
  onClose,
  highlightChunkId,
}: PipelineTraceViewerProps) {
  const titleId = useId();
  const { token: authToken } = useAuth();
  const [fetchedNodeSpecs, setFetchedNodeSpecs] = useState<NodeSpec[]>([]);
  const [specsLoaded, setSpecsLoaded] = useState(false);
  const [nodeSpecsError, setNodeSpecsError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showInputPayloads, setShowInputPayloads] = useState(false);
  const [showOutputPayloads, setShowOutputPayloads] = useState(false);

  const nodeSpecs = providedNodeSpecs ?? fetchedNodeSpecs;

  useEffect(() => {
    if (!isOpen || providedNodeSpecs || specsLoaded) return;
    let cancelled = false;
    const effectiveToken = token ?? authToken ?? "";
    fetchPipelineNodes(effectiveToken)
      .then((specs) => {
        if (!cancelled) {
          setFetchedNodeSpecs(specs);
          setSpecsLoaded(true);
          setNodeSpecsError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpecsLoaded(true);
          setNodeSpecsError(
            "Node details are unavailable right now; showing the trace without them.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, providedNodeSpecs, specsLoaded, token, authToken]);

  const orderedRuns = useMemo(
    () => (trace ? [...trace.node_runs].sort((a, b) => a.sequence_index - b.sequence_index) : []),
    [trace],
  );

  const { nodes, edges } = useMemo(() => {
    if (!trace) return { nodes: [], edges: [] };
    const runMap = new Map(orderedRuns.map((run) => [run.node_id, run]));
    let flowNodes: Node<PipelineNodeData>[] = toFlowNodes(trace.definition, nodeSpecs).map(
      (node) => ({
        ...node,
        data: { ...node.data, status: runMap.get(node.id)?.status },
      }),
    );
    const flowEdges = toFlowEdges(trace.definition, nodeSpecs);
    if (needsAutoLayout(flowNodes)) {
      flowNodes = layoutPipelineNodes(flowNodes, flowEdges);
    }
    return { nodes: flowNodes, edges: flowEdges };
  }, [trace, nodeSpecs, orderedRuns]);

  const steps = useMemo(() => orderedRuns.map((run) => ({ nodeId: run.node_id })), [orderedRuns]);

  const ioByNode = useMemo(() => {
    const grouped = new Map<string, IOGroup>();
    if (!trace) return grouped;
    trace.node_io.forEach((record) => {
      const entry = grouped.get(record.node_id) ?? { inputs: [], outputs: [] };
      if (record.io_type === "input") {
        entry.inputs.push(record);
      } else {
        entry.outputs.push(record);
      }
      grouped.set(record.node_id, entry);
    });
    return grouped;
  }, [trace]);

  const handleActiveStepChange = useCallback((index: number) => {
    setActiveIndex(index);
    setShowInputPayloads(false);
    setShowOutputPayloads(false);
  }, []);

  const activeRun = orderedRuns[activeIndex];
  const selectedIO = activeRun ? ioByNode.get(activeRun.node_id) : undefined;
  const activeSummary = activeRun?.summary ?? { inputs: [], outputs: [] };

  if (!isOpen || !trace) {
    return null;
  }

  return (
    <ModalOverlay
      open={isOpen}
      onClose={onClose}
      labelledBy={titleId}
      backdropClassName="bg-black/70 px-6 py-6"
    >
      <div className="relative h-full w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/95 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Pipeline trace</p>
            <h2 id={titleId} className="text-xl font-semibold text-white">
              {trace.run.status.toUpperCase()} trace
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {highlightChunkId && (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-cyan-200">
                chunk {highlightChunkId}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>
        </div>

        <div className="flex h-[calc(100%-64px)] flex-col gap-4 overflow-y-auto p-6">
          {nodeSpecsError && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
              {nodeSpecsError}
            </div>
          )}
          <GlassCard className="relative min-h-[420px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80">
            <div className="h-full min-h-[420px]">
              <FlowPlayer
                nodes={nodes}
                edges={edges}
                steps={steps}
                onActiveStepChange={handleActiveStepChange}
              />
            </div>
          </GlassCard>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Active node</p>
                <h3 className="text-lg font-semibold text-white">
                  {activeRun?.node_name || activeRun?.node_id || "—"}
                </h3>
              </div>
              {activeRun && (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300">
                  {activeRun.status}
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TraceIOColumn
              title="Inputs"
              tone="cyan"
              summaryItems={activeSummary.inputs}
              ioRecords={selectedIO?.inputs}
              highlightChunkId={highlightChunkId}
              showPayloads={showInputPayloads}
              onTogglePayloads={() => setShowInputPayloads((prev) => !prev)}
              emptySummaryLabel="No primary inputs recorded."
              emptyIoLabel="No inputs recorded."
            />
            <TraceIOColumn
              title="Outputs"
              tone="violet"
              summaryItems={activeSummary.outputs}
              ioRecords={selectedIO?.outputs}
              highlightChunkId={highlightChunkId}
              showPayloads={showOutputPayloads}
              onTogglePayloads={() => setShowOutputPayloads((prev) => !prev)}
              emptySummaryLabel="No primary outputs recorded."
              emptyIoLabel="No outputs recorded."
            />
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
