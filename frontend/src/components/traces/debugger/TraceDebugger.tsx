"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { useTraceDebugger } from "@/components/traces/debugger/hooks/use-trace-debugger";
import { useTraceStepper } from "@/components/traces/debugger/hooks/use-trace-stepper";
import { InspectorPanel } from "@/components/traces/debugger/InspectorPanel";
import { StepRail } from "@/components/traces/debugger/StepRail";
import { TraceHeader } from "@/components/traces/debugger/TraceHeader";
import { traceNodeTypes } from "@/components/traces/IndexStoreNode";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

import type { TraceSource } from "@/components/traces/debugger/hooks/use-trace-debugger";
import type { TraceGraph } from "@/components/traces/trace-graph";
import type { PipelineTraceResponse } from "@/lib/types";

type TraceDebuggerProps = {
  source: TraceSource;
};

/**
 * Full-page pipeline debugger: loads the trace the route points at, then
 * renders the step rail, the flow graph, and the node inspector around one
 * shared playback state.
 */
export function TraceDebugger({ source }: TraceDebuggerProps) {
  const router = useRouter();
  const { graph, trace, error, reload, specsNotice } = useTraceDebugger(source);

  if (!graph || !trace) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-hairline bg-canvas-raised">
        {error ? (
          <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              Trace unavailable
            </p>
            <p className="text-sm text-body">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => router.back()} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
          </div>
        ) : (
          <Loader className="h-6 w-6" />
        )}
      </div>
    );
  }

  return (
    <LoadedTraceDebugger
      graph={graph}
      trace={trace}
      chunkId={source.chunkId}
      specsNotice={specsNotice}
      onRefresh={reload}
    />
  );
}

type LoadedTraceDebuggerProps = {
  graph: TraceGraph;
  trace: PipelineTraceResponse;
  chunkId: string | null;
  specsNotice: string | null;
  onRefresh: () => void;
};

/** Mounted only once the graph exists, so the stepper can seed itself from it. */
function LoadedTraceDebugger({
  graph,
  trace,
  chunkId,
  specsNotice,
  onRefresh,
}: LoadedTraceDebuggerProps) {
  const { playback, activeStep } = useTraceStepper(graph);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas-raised">
      <TraceHeader
        trace={trace}
        combined={graph.combined}
        chunkId={chunkId}
        onRefresh={onRefresh}
      />
      {specsNotice && (
        <div className="shrink-0 border-b border-data-warn/30 bg-data-warn/10 px-4 py-1.5 text-xs text-data-warn">
          {specsNotice}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="order-2 min-h-0 shrink-0 border-t border-hairline md:order-1 md:w-64 md:border-r md:border-t-0">
          <StepRail
            steps={graph.steps}
            activeIndex={playback.activeIndex}
            onSelect={playback.seek}
          />
        </div>
        <div className="order-1 min-h-0 min-w-0 flex-1 md:order-2">
          <FlowPlayer
            nodes={graph.nodes}
            edges={graph.edges}
            steps={graph.steps}
            playback={playback}
            nodeTypes={graph.combined ? traceNodeTypes : undefined}
            fitViewPadding={0.18}
          />
        </div>
      </div>
      <div className="h-[38%] min-h-[220px] shrink-0 border-t border-hairline">
        <InspectorPanel key={playback.activeIndex} step={activeStep} highlightChunkId={chunkId} />
      </div>
    </div>
  );
}
