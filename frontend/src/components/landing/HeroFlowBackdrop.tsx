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
  // Anchor the viewport on each scene's entry node (the first playback step)
  // so it sits at the same screen height in every scene — fitView alone
  // centers the bounding box, which shifts the main row when a hybrid scene
  // adds a second branch row.
  const anchorNodeId = steps[0]?.nodeIds[0];

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
        anchorNodeId={anchorNodeId}
        // Full-bleed decorative surface: let wide scenes shrink far enough to
        // fit narrow (mobile) viewports instead of rendering clipped.
        minZoom={0.05}
        fitViewPadding={0.18}
      />
    </div>
  );
}
