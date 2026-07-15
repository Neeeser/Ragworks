import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useFlowNodeActive } from "../active-nodes-context";
import { FlowPlayer } from "../FlowPlayer";

import type { PipelineNodeData } from "../../PipelineNode";
import type { TypedEdgeType } from "../TypedEdge";
import type { Node, NodeProps } from "@xyflow/react";

const nodeData = (label: string): PipelineNodeData => ({
  label,
  nodeType: "chunker.token",
  inputs: [],
  outputs: [],
  config: {},
});

const nodes: Node<PipelineNodeData>[] = [
  { id: "first", type: "pipelineNode", position: { x: 0, y: 0 }, data: nodeData("First") },
  { id: "second", type: "pipelineNode", position: { x: 400, y: 0 }, data: nodeData("Second") },
];

const edges: TypedEdgeType[] = [
  { id: "edge-1", source: "first", target: "second", type: "typed", data: {} },
];

const steps = [{ nodeIds: ["first"] }, { nodeIds: ["second"] }];

const NEXT_STEP = "Next step";
const SPY_FIRST = "spy-first";
const SPY_SECOND = "spy-second";

/** Captures the data reference each node renders with, per step transition. */
const seenData = new Map<string, Set<PipelineNodeData>>();

function SpyNode({ id, data }: NodeProps<Node<PipelineNodeData>>) {
  const active = useFlowNodeActive(id);
  const seen = seenData.get(id) ?? new Set();
  seen.add(data);
  seenData.set(id, seen);
  return <div data-testid={`spy-${id}`}>{active ? `${id}-active` : `${id}-idle`}</div>;
}

const renderPlayer = () => {
  seenData.clear();
  return render(
    <FlowPlayer
      nodes={nodes}
      edges={edges}
      steps={steps}
      fitViewPadding={0.2}
      nodeTypes={{ pipelineNode: SpyNode }}
    />,
  );
};

describe("FlowPlayer node identity across steps", () => {
  it("marks only the current step's nodes active through the playback context", async () => {
    renderPlayer();
    const user = userEvent.setup();

    expect(await screen.findByTestId(SPY_FIRST)).toHaveTextContent("first-active");
    expect(screen.getByTestId(SPY_SECOND)).toHaveTextContent("second-idle");

    await user.click(screen.getByRole("button", { name: NEXT_STEP }));

    expect(screen.getByTestId(SPY_FIRST)).toHaveTextContent("first-idle");
    expect(screen.getByTestId(SPY_SECOND)).toHaveTextContent("second-active");
  });

  it("keeps node data identity stable when the active step changes", async () => {
    renderPlayer();
    const user = userEvent.setup();
    await screen.findByTestId(SPY_FIRST);

    await user.click(screen.getByRole("button", { name: NEXT_STEP }));
    await screen.findByTestId(SPY_SECOND);

    // A step transition must not rebuild the node objects: React Flow
    // re-adopts a node whose reference changed, drops its measured
    // dimensions, and hides the whole graph for a frame (the playback
    // flash). One data reference per node across both steps pins that.
    expect([...(seenData.get("first") ?? [])]).toHaveLength(1);
    expect([...(seenData.get("second") ?? [])]).toHaveLength(1);
  });
});
