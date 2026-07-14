"use client";

import { Background, ReactFlow, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";

import { PipelineEdgeRoutingProvider } from "@/components/pipelines/flow/PipelineEdgeRoutingProvider";
import { pipelineEdgeTypes } from "@/components/pipelines/flow/TypedEdge";
import { useFlowDotColor } from "@/components/pipelines/flow/use-flow-dot-color";
import { pipelineNodeTypes } from "@/components/pipelines/PipelineNode";
import { buildSetupFlow } from "@/components/setup/lib/setup-flow";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

import type { SetupStepId } from "@/components/setup/lib/setup-wizard-reducer";

const FLY_MS = 900;
const FOCUS_ZOOM = 1.05;
// Screen-space pixels the focused node is lifted above the viewport center,
// so it sits centered above the step copy instead of hiding behind it. Large
// on purpose: the band should clear even the tallest step (the model list).
const SCREEN_LIFT_PX = 290;

function ViewportDirector({ step }: { step: SetupStepId }) {
  const { setCenter, getNode } = useReactFlow();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const duration = reducedMotion ? 0 : FLY_MS;
    // Node ids double as step ids, so the camera glides strictly left to
    // right (or back) along the line — never skipping around the graph.
    const node = getNode(step);
    if (!node) return;
    const width = node.measured?.width ?? 260;
    const height = node.measured?.height ?? 150;
    void setCenter(
      node.position.x + width / 2,
      node.position.y + height / 2 + SCREEN_LIFT_PX / FOCUS_ZOOM,
      { zoom: FOCUS_ZOOM, duration },
    );
  }, [step, reducedMotion, setCenter, getNode]);

  return null;
}

/**
 * The wizard's living backdrop: a synthetic pipeline with one node per setup
 * step, in step order, with the camera flying to the current step's node
 * (which glows as `active`). Non-interactive and aria-hidden — decoration
 * built from the real product component, never a fake illustration.
 */
export function SetupFlowBackdrop({ step }: { step: SetupStepId }) {
  const { nodes, edges } = useMemo(() => buildSetupFlow(), []);
  const dotColor = useFlowDotColor();

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        draggable: false,
        connectable: false,
        data: { ...node.data, active: node.id === step },
      })),
    [nodes, step],
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-35 [mask-image:radial-gradient(120%_75%_at_50%_45%,black_55%,transparent_92%)]"
    >
      <PipelineEdgeRoutingProvider nodes={decoratedNodes}>
        <ReactFlow
          nodes={decoratedNodes}
          edges={edges}
          nodeTypes={pipelineNodeTypes}
          edgeTypes={pipelineEdgeTypes}
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnDrag={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color={dotColor} />
          <ViewportDirector step={step} />
        </ReactFlow>
      </PipelineEdgeRoutingProvider>
    </div>
  );
}
