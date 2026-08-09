"use client";

import { useState } from "react";

import { LANDING_SCENES } from "@/components/landing/lib/scenes";
import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";

type ReadmePipelineCaptureProps = {
  sceneId: string;
};

/**
 * One frame of the README animation: a single scene from the landing
 * rotation, played once. The capture script drives this page per scene and
 * stitches the recordings, so both illustrations show the same cycle by
 * construction.
 *
 * `readme-capture` drops every elevation token to zero. The console's card
 * shadows are soft, wide blurs — GIF's 256-colour quantization bands them, and
 * the control bar's shadow spreads past the box the encoder paints over its
 * corner, leaving a smudge with nothing casting it.
 */
export function ReadmePipelineCapture({ sceneId }: ReadmePipelineCaptureProps) {
  const [playing, setPlaying] = useState(false);
  const scene = LANDING_SCENES.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`Unknown README capture scene "${sceneId}".`);
  }
  const { nodes, edges, steps } = scene.build();

  return (
    <main
      className="readme-capture relative h-screen min-h-[600px] overflow-hidden bg-canvas text-primary"
      data-readme-capture={scene.id}
      data-playback-state={playing ? "playing" : "ready"}
      data-step-count={steps.length}
    >
      <button type="button" className="sr-only" data-capture-start onClick={() => setPlaying(true)}>
        Start pipeline capture
      </button>
      <header className="pointer-events-none absolute inset-x-0 top-8 z-10 text-center">
        <h1 className="font-mono text-sm uppercase tracking-[0.28em] text-muted">{scene.label}</h1>
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
          fitViewPadding={0.05}
        />
      </div>
    </main>
  );
}
