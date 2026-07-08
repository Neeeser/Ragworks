import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineCanvas } from "@/components/pipelines/PipelineCanvas";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";

let lastReactFlowProps: Record<string, unknown> | null = null;

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: { children?: ReactNode } & Record<string, unknown>) => {
    lastReactFlowProps = props;
    return <div data-testid="reactflow">{props.children}</div>;
  },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
}));

describe("PipelineCanvas", () => {
  it("renders pipeline header and notice", () => {
    const onNodeSelect = vi.fn();
    const nodes: Node<PipelineNodeData>[] = [];
    const edges: TypedEdgeType[] = [];

    render(
      <PipelineCanvas
        nodes={nodes}
        edges={edges}
        selectedPipeline={{
          id: "pipe-1",
          user_id: "user-1",
          name: "Pipeline",
          kind: "ingestion",
          current_version: 1,
          is_default: false,
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
          definition: { nodes: [], edges: [] },
        }}
        notice="Hello"
        onNoticeDismiss={() => undefined}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={onNodeSelect}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    expect(screen.getByText(/Pipeline · v1/)).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByTestId("background")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();

    const onNodeClick = lastReactFlowProps?.onNodeClick as
      | ((event: unknown, node: { id: string }) => void)
      | undefined;
    onNodeClick?.(null, { id: "node-1" });
    expect(onNodeSelect).toHaveBeenCalledWith("node-1");
  });

  it("shows empty selection state without a pipeline", () => {
    render(
      <PipelineCanvas
        nodes={[]}
        edges={[]}
        selectedPipeline={null}
        notice={null}
        onNoticeDismiss={() => undefined}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    expect(screen.getByText("Select a pipeline to edit.")).toBeInTheDocument();
  });
});
