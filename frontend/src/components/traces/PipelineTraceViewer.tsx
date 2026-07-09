"use client";

import { ArrowDown, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { traceNodeTypes } from "@/components/traces/IndexStoreNode";
import { buildTraceGraph } from "@/components/traces/trace-graph";
import { TraceIOColumn } from "@/components/traces/TraceIOColumn";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";
import { fetchPipelineNodes } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { NodeSpec, PipelineTraceResponse } from "@/lib/types";

type PipelineTraceViewerProps = {
  trace: PipelineTraceResponse | null;
  /**
   * The ingestion run that produced the traced chunk. When present, the viewer
   * plays the document's ingestion first, then the retrieval, as one flow.
   */
  originTrace?: PipelineTraceResponse | null;
  /** Optional explicit token; falls back to the signed-in user's token when omitted. */
  token?: string;
  /** When provided, skips the internal node-spec fetch and uses these instead. */
  nodeSpecs?: NodeSpec[];
  isOpen: boolean;
  onClose: () => void;
  highlightChunkId?: string | null;
};

export function PipelineTraceViewer({
  trace,
  originTrace = null,
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

  const graph = useMemo(
    () => (trace ? buildTraceGraph(trace, originTrace, nodeSpecs) : null),
    [trace, originTrace, nodeSpecs],
  );

  const handleActiveStepChange = useCallback((index: number) => {
    setActiveIndex(index);
    setShowInputPayloads(false);
    setShowOutputPayloads(false);
  }, []);

  if (!isOpen || !trace || !graph) {
    return null;
  }

  const activeStep = graph.steps[activeIndex];
  const activeRun = activeStep?.run ?? null;
  const activeSummary = activeRun?.summary ?? { inputs: [], outputs: [] };

  return (
    <ModalOverlay
      open={isOpen}
      onClose={onClose}
      labelledBy={titleId}
      backdropClassName="bg-black/70 px-6 py-6"
    >
      {/* Definite viewport-relative height (matching the backdrop's py-6 =
          3rem) so the inner flex-1 IO region can bound and scroll; a plain
          h-full has no definite basis here and would overflow on short/mobile
          screens, clipping the header. */}
      <div className="relative flex h-[calc(100dvh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/95 shadow-2xl sm:rounded-[32px]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500 sm:text-xs">
              {graph.combined ? "End-to-end trace" : "Pipeline trace"}
            </p>
            <h2 id={titleId} className="truncate text-base font-semibold text-white sm:text-xl">
              {graph.combined ? "Document → retrieval" : `${trace.run.status.toUpperCase()} trace`}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {highlightChunkId && (
              <span className="hidden max-w-[200px] truncate rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-cyan-200 lg:inline-block">
                chunk {highlightChunkId}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
              <X className="h-4 w-4" />
              <span className="hidden sm:inline">Close</span>
            </Button>
          </div>
        </div>

        {/* Fixed regions (banner, graph, active node) stay pinned; only the IO
            region below scrolls, so stepping never reflows the layout. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:gap-4 sm:p-6">
          {nodeSpecsError && (
            <div className="shrink-0 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
              {nodeSpecsError}
            </div>
          )}
          {graph.combined && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> Ingestion — how this chunk
                was made
              </span>
              <ArrowDown className="h-3.5 w-3.5 rotate-[-90deg] text-slate-500 sm:rotate-0" />
              <span className="flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-violet-200">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-300" /> Retrieval — how it was
                found
              </span>
            </div>
          )}
          <GlassCard className="relative shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80">
            {/* ReactFlow needs a concretely sized parent, not min-height. */}
            <div
              className={cn(graph.combined ? "h-[300px] sm:h-[440px]" : "h-[240px] sm:h-[380px]")}
            >
              <FlowPlayer
                nodes={graph.nodes}
                edges={graph.edges}
                steps={graph.steps}
                nodeTypes={graph.combined ? traceNodeTypes : undefined}
                onActiveStepChange={handleActiveStepChange}
              />
            </div>
          </GlassCard>

          <div className="flex shrink-0 items-center justify-between gap-2 rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400 sm:text-xs">
                {activeStep ? activeStep.stageLabel : "Active node"}
              </p>
              <h3 className="truncate text-base font-semibold text-white sm:text-lg">
                {activeRun?.node_name || activeStep?.nodeId || "—"}
              </h3>
            </div>
            {activeRun && (
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300">
                {activeRun.status}
              </span>
            )}
          </div>

          {/* The only scrolling region — locked height, big values scroll here. */}
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-2">
            <TraceIOColumn
              title="Inputs"
              tone="cyan"
              summaryItems={activeSummary.inputs}
              ioRecords={activeStep?.io.inputs}
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
              ioRecords={activeStep?.io.outputs}
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
