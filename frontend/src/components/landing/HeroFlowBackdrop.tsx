"use client";

import { useMemo } from "react";

import { useSceneRotation } from "@/components/landing/hooks/use-scene-rotation";
import { LANDING_SCENES } from "@/components/landing/lib/scenes";
import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * The hero's signature: synthetic RAG pipelines running continuously behind
 * the headline, rotating Factorio-intro style through the scene registry
 * (semantic and hybrid, ingestion and retrieval). Each scene plays through
 * the *same* `FlowPlayer` the trace viewer uses, so the backdrop stays
 * visually in lockstep with the product — but fed hand-authored, in-memory
 * data (no telemetry, no traces, no network). Purely decorative:
 * non-interactive, aria-hidden, faded at the edges so it never competes with
 * the copy on top. Under `prefers-reduced-motion` the first scene renders
 * statically and the rotation never starts.
 */
export function HeroFlowBackdrop() {
  const animate = !usePrefersReducedMotion();
  const { scene, fading, onRunComplete } = useSceneRotation(LANDING_SCENES);
  const { nodes, edges, steps } = useMemo(() => scene.build(), [scene]);
  // fitView centers the graph's bounding box, so a two-row hybrid scene would
  // push its main row up into the headline; nudge tall scenes further down so
  // the main row stays in the clear band the copy leaves for it.
  const tall = useMemo(() => new Set(nodes.map((node) => node.position.y)).size > 1, [nodes]);

  return (
    // Each scene is a short horizontal band (one row, or two for hybrid
    // branches), so the mask is a wide ellipse: the flow reads as a band
    // running across the hero's middle, fading out above/below (clearing the
    // headline and subhead) and at the left/right edges. The hero copy leaves
    // a clear gap here for it to run through — see LandingPage. The layer is
    // nudged down slightly so the band runs through the clear gap below the
    // headline instead of across it.
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 transition-opacity duration-[400ms] [mask-image:radial-gradient(105%_46%_at_50%_50%,black_45%,transparent_85%)]",
        tall ? "translate-y-[12%]" : "translate-y-[3%]",
        fading ? "opacity-0" : "opacity-30",
      )}
    >
      {/* Keyed by scene so each rotation remounts the player and autoplays fresh. */}
      <FlowPlayer
        key={scene.id}
        nodes={nodes}
        edges={edges}
        steps={steps}
        ambient
        autoPlay={animate}
        loop={false}
        onRunComplete={animate ? onRunComplete : undefined}
        fitViewPadding={0.18}
      />
    </div>
  );
}
