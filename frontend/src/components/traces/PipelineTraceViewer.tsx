"use client";

import { Background, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import { FileText, Pause, Play, StepForward, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import { pipelineNodeTypes } from "@/components/pipelines/PipelineNode";
import { buildFallbackPosition } from "@/components/traces/trace-payload-utils";
import { TraceIOColumn } from "@/components/traces/TraceIOColumn";
import { useTraceFlowGraph } from "@/components/traces/use-trace-flow-graph";
import { useTracePlayback } from "@/components/traces/use-trace-playback";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";
import { fetchPipelineNodes } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import type { NodeSpec, PipelineTraceResponse } from "@/lib/types";

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

const TraceCursorNode = () => (
  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-200/70 bg-cyan-500/20 text-cyan-100 shadow-lg">
    <FileText className="h-4 w-4" />
  </div>
);

const traceNodeTypes = {
  pipelineNode: pipelineNodeTypes.pipelineNode,
  traceCursor: TraceCursorNode,
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
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [showInputPayloads, setShowInputPayloads] = useState(false);
  const [showOutputPayloads, setShowOutputPayloads] = useState(false);
  const resetPayloadToggles = useCallback(() => {
    setShowInputPayloads(false);
    setShowOutputPayloads(false);
  }, []);

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

  // Node positions/status only - deliberately excludes the "active" highlight flag so
  // it can be computed before we know the active node (see useTracePlayback below).
  const positionedNodes = useMemo(() => {
    if (!trace) return [];
    const nodes = trace.definition.nodes.map((node, index) => ({
      ...node,
      position: node.position ?? buildFallbackPosition(index),
    }));
    const definition = { ...trace.definition, nodes };
    const flowNodes = toFlowNodes(definition, nodeSpecs);
    const runMap = new Map(orderedRuns.map((run) => [run.node_id, run]));
    return flowNodes.map((node) => ({
      ...node,
      data: { ...node.data, status: runMap.get(node.id)?.status },
    }));
  }, [trace, nodeSpecs, orderedRuns]);

  const {
    activeIndex,
    activeNodeId,
    isPlaying,
    togglePlaying,
    handleNodeClick,
    handleStepForward,
  } = useTracePlayback({
    orderedRuns,
    flowInstance,
    baseNodes: positionedNodes,
    resetPayloadToggles,
  });

  const { nodes, edges, ioByNode } = useTraceFlowGraph({
    trace,
    positionedNodes,
    orderedRuns,
    activeIndex,
    activeNodeId,
  });

  const selectedIO = activeNodeId ? ioByNode.get(activeNodeId) : undefined;
  const activeSummary = orderedRuns[activeIndex]?.summary ?? { inputs: [], outputs: [] };

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
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>

        <div className="flex h-[calc(100%-64px)] flex-col gap-4 overflow-y-auto p-6">
          {nodeSpecsError && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
              {nodeSpecsError}
            </div>
          )}
          <GlassCard className="relative min-h-[420px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80">
            <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={togglePlaying}
                className="flex items-center gap-2"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isPlaying ? "Pause trace" : "Play trace"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleStepForward}
                className="flex items-center gap-2"
              >
                <StepForward className="h-4 w-4" />
                Step
              </Button>
            </div>
            {highlightChunkId && (
              <div className="absolute right-4 top-4 z-10 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-cyan-200">
                chunk {highlightChunkId}
              </div>
            )}
            <div className="h-full min-h-[420px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={traceNodeTypes}
                onNodeClick={handleNodeClick}
                onInit={setFlowInstance}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={18} size={1} color="#1f2937" />
                <Controls className="pipeline-controls" />
              </ReactFlow>
            </div>
          </GlassCard>

          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Active node</p>
                <h3 className="text-lg font-semibold text-white">
                  {orderedRuns[activeIndex]?.node_name || activeNodeId || "—"}
                </h3>
              </div>
              {orderedRuns[activeIndex] && (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300">
                  {orderedRuns[activeIndex]?.status}
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
