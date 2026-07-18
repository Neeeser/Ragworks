"use client";

import { useState } from "react";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { buildDefaultPipelineFlow } from "@/components/pipelines/lib/default-pipeline-flow";

import type { PipelineKind } from "@/lib/types";

type ReadmePipelineCaptureProps = {
  kind: PipelineKind;
};

export function ReadmePipelineCapture({ kind }: ReadmePipelineCaptureProps) {
  const [playing, setPlaying] = useState(false);
  const { nodes, edges, steps } = buildDefaultPipelineFlow(kind);

  return (
    <main
      className="relative h-screen min-h-[600px] overflow-hidden bg-canvas text-primary"
      data-readme-capture={kind}
      data-playback-state={playing ? "playing" : "ready"}
      data-step-count={steps.length}
    >
      <button type="button" className="sr-only" data-capture-start onClick={() => setPlaying(true)}>
        Start pipeline capture
      </button>
      <header className="pointer-events-none absolute inset-x-0 top-8 z-10 text-center">
        <h1 className="font-mono text-sm uppercase tracking-[0.28em] text-muted">
          Default {kind} pipeline
        </h1>
      </header>
      <div className="absolute inset-x-0 bottom-0 top-14">
        <FlowPlayer
          key={playing ? "playing" : "ready"}
          nodes={nodes}
          edges={edges}
          steps={steps}
          autoPlay={playing}
          ambient
          loop={false}
          processMs={550}
          travelMs={400}
          fitViewPadding={0.05}
        />
      </div>
    </main>
  );
}
