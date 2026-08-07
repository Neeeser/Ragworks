import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makePipeline } from "@/test/fixtures";

import { usePipelineDeepLink } from "../use-pipeline-deep-link";

import type { PipelineNodeData } from "../../PipelineNode";
import type { Node } from "@xyflow/react";

const NODE_ID = "node-9";

const canvasNode = (id: string): Node<PipelineNodeData> => ({
  id,
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeType: "embedder.text",
    inputs: [],
    outputs: [],
    config: {},
    configSchema: {},
  },
});

/** Two pipelines in this editor's kind; the link targets the second. */
function renderDeepLink() {
  const pipelines = [makePipeline({ id: "pipe-1" }), makePipeline({ id: "pipe-2" })];
  const seedPipeline = vi.fn();
  const switchPipeline = vi.fn();
  const openNode = vi.fn();
  const hook = renderHook(
    ({ nodes }: { nodes: Node<PipelineNodeData>[] }) =>
      usePipelineDeepLink({ pipelines, nodes, seedPipeline, switchPipeline, openNode }),
    { initialProps: { nodes: [] as Node<PipelineNodeData>[] } },
  );
  return { hook, pipelines, seedPipeline, switchPipeline, openNode };
}

describe("usePipelineDeepLink", () => {
  it("opens a node once its pipeline's graph is on the canvas", () => {
    const { hook, pipelines, switchPipeline, openNode } = renderDeepLink();

    act(() => {
      expect(hook.result.current("pipe-2", NODE_ID)).toBe(true);
    });

    // Switching goes through the guarded path, so unsaved work is not lost.
    expect(switchPipeline).toHaveBeenCalledWith(pipelines[1]);
    // The canvas is still empty, and selecting now would be wiped by seeding.
    expect(openNode).not.toHaveBeenCalled();

    hook.rerender({ nodes: [canvasNode(NODE_ID)] });

    expect(openNode).toHaveBeenCalledWith(NODE_ID);
  });

  it("declines a pipeline this editor does not hold", () => {
    const { hook, switchPipeline } = renderDeepLink();

    // False is what lets the caller fall back to following the link.
    expect(hook.result.current("pipe-missing", NODE_ID)).toBe(false);
    expect(switchPipeline).not.toHaveBeenCalled();
  });
});
