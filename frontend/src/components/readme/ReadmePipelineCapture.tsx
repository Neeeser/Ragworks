"use client";

import { useState } from "react";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import { toFlowEdges, toFlowNodes } from "@/components/pipelines/lib/pipeline-utils";
import fixtureJson from "@/components/readme/readme-pipelines.generated.json";

import type { NodeSpec, PipelineDefinition, PipelineKind } from "@/lib/types";

type CaptureFixture = {
  scenes: { kind: PipelineKind; definition: PipelineDefinition }[];
  node_specs: NodeSpec[];
};

type ReadmePipelineCaptureProps = {
  kind: PipelineKind;
};

// This generated JSON is validated by the backend exporter test before it reaches
// the TypeScript boundary; the cast gives its literal JSON shape the wire-contract type.
const fixture = fixtureJson as CaptureFixture;

export function ReadmePipelineCapture({ kind }: ReadmePipelineCaptureProps) {
  const [playing, setPlaying] = useState(false);
  const scene = fixture.scenes.find((candidate) => candidate.kind === kind);
  if (!scene) {
    throw new Error(`Missing README capture fixture for ${kind}.`);
  }
  // The exported fixture carries no positions; the capture is placed by the
  // same auto-layout the editor and Tidy use.
  const edges = toFlowEdges(scene.definition, fixture.node_specs);
  const nodes = layoutPipelineNodes(toFlowNodes(scene.definition, fixture.node_specs), edges);
  const steps = buildTopologyPlaybackSteps(scene.definition);

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
