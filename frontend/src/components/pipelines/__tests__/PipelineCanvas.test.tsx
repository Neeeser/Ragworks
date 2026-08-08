import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineCanvas } from "@/components/pipelines/PipelineCanvas";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";

let lastReactFlowProps: Record<string, unknown> | null = null;

const RETRIEVER_TYPE = "retriever.vector";

vi.mock("@/components/pipelines/flow/PipelineEdgeRoutingProvider", () => ({
  PipelineEdgeRoutingProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="routing-provider">{children}</div>
  ),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: { children?: ReactNode } & Record<string, unknown>) => {
    lastReactFlowProps = props;
    return (
      <div data-testid="reactflow" tabIndex={-1}>
        {props.children}
      </div>
    );
  },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  ConnectionLineType: { SmoothStep: "smoothstep" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  NodeToolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Handle: () => <div />,
}));

describe("PipelineCanvas", () => {
  beforeEach(() => {
    lastReactFlowProps = null;
  });

  it("renders pipeline header and notice", () => {
    const onNodeSelect = vi.fn();
    const nodes: Node<PipelineNodeData>[] = [];
    const edges: TypedEdgeType[] = [];

    render(
      <PipelineCanvas
        canvasKey="test"
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
        onNodeOpen={() => undefined}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    // The open pipeline's name and revision live in the top bar, not on the
    // canvas — the canvas only says something when nothing is selected.
    expect(screen.queryByText("Select a pipeline to edit.")).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByTestId("background")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
    expect(screen.getByTestId("routing-provider")).toBeInTheDocument();

    const onNodeClick = lastReactFlowProps?.onNodeClick as
      | ((event: unknown, node: { id: string }) => void)
      | undefined;
    onNodeClick?.(null, { id: "node-1" });
    expect(onNodeSelect).toHaveBeenCalledWith("node-1");
  });

  it("opens the inspector on double click, not on a single click", () => {
    const onNodeSelect = vi.fn();
    const onNodeOpen = vi.fn();

    render(
      <PipelineCanvas
        canvasKey="test"
        nodes={[]}
        edges={[]}
        selectedPipeline={null}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={onNodeSelect}
        onNodeOpen={onNodeOpen}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    const click = lastReactFlowProps?.onNodeClick as (e: unknown, n: { id: string }) => void;
    const doubleClick = lastReactFlowProps?.onNodeDoubleClick as (
      e: unknown,
      n: { id: string },
    ) => void;

    click(null, { id: "node-1" });
    expect(onNodeOpen).not.toHaveBeenCalled();

    doubleClick(null, { id: "node-1" });
    expect(onNodeOpen).toHaveBeenCalledWith("node-1");
  });

  // The only way to remove a node without the toolbar. React Flow binds
  // Backspace alone by default, and Delete is the key users reach for.
  it("binds both Delete and Backspace to node deletion", () => {
    render(
      <PipelineCanvas
        canvasKey="test"
        nodes={[]}
        edges={[]}
        selectedPipeline={null}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={() => undefined}
        onNodeOpen={() => undefined}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    expect(lastReactFlowProps?.deleteKeyCode).toEqual(["Delete", "Backspace"]);
  });

  it("opens the selected node on Enter", async () => {
    const user = userEvent.setup();
    const onNodeOpen = vi.fn();
    const nodes = [
      {
        id: "node-1",
        type: "pipelineNode",
        position: { x: 0, y: 0 },
        selected: true,
        data: {
          label: "Retriever",
          nodeType: RETRIEVER_TYPE,
          inputs: [],
          outputs: [],
          config: {},
        },
      },
    ] satisfies Node<PipelineNodeData>[];

    render(
      <PipelineCanvas
        canvasKey="test"
        nodes={nodes}
        edges={[]}
        selectedPipeline={null}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={() => undefined}
        onNodeOpen={onNodeOpen}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    screen.getByTestId("reactflow").focus();
    await user.keyboard("{Enter}");

    expect(onNodeOpen).toHaveBeenCalledWith("node-1");
  });

  it("steps from a node card into that node's toolbar on Tab", async () => {
    const user = userEvent.setup();
    const nodes = [
      {
        id: "node-1",
        type: "pipelineNode",
        position: { x: 0, y: 0 },
        selected: true,
        data: {
          label: "Retriever",
          nodeType: RETRIEVER_TYPE,
          inputs: [],
          outputs: [],
          config: {},
        },
      },
    ] satisfies Node<PipelineNodeData>[];

    render(
      <PipelineCanvas
        canvasKey="test"
        nodes={nodes}
        edges={[]}
        selectedPipeline={null}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={() => undefined}
        onNodeOpen={() => undefined}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    // React Flow's card, and the toolbar it portals to the end of the canvas
    // — which is exactly why Tab cannot find it on its own.
    const card = document.createElement("div");
    card.className = "react-flow__node";
    card.dataset.id = "node-1";
    card.tabIndex = 0;
    screen.getByTestId("reactflow").append(card);
    // Another card sits between the two in document order, which is where a
    // plain Tab would land.
    const otherCard = document.createElement("div");
    otherCard.className = "react-flow__node";
    otherCard.dataset.id = "node-2";
    otherCard.tabIndex = 0;
    screen.getByTestId("reactflow").append(otherCard);
    const toolbar = document.createElement("div");
    toolbar.className = "react-flow__node-toolbar";
    toolbar.dataset.id = "node-1";
    toolbar.innerHTML = '<div role="toolbar"><button type="button">Edit node</button></div>';
    screen.getByTestId("reactflow").append(toolbar);

    card.focus();
    await user.tab();

    expect(toolbar.querySelector("button")).toHaveFocus();
  });

  it("names the edit and delete keys in the canvas legend", () => {
    const nodes = [
      {
        id: "node-1",
        type: "pipelineNode",
        position: { x: 0, y: 0 },
        data: {
          label: "Retriever",
          nodeType: RETRIEVER_TYPE,
          inputs: [
            {
              key: "query",
              label: "Query",
              data_type: "text",
              requires: [],
              accepts: [],
              accepts_many: false,
              required: true,
            },
          ],
          outputs: [],
          config: {},
        },
      },
    ] as unknown as Node<PipelineNodeData>[];

    render(
      <PipelineCanvas
        canvasKey="test"
        nodes={nodes}
        edges={[]}
        selectedPipeline={null}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={() => undefined}
        onNodeOpen={() => undefined}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    // Delete is otherwise only in a hover tooltip, which a touch device never
    // shows.
    expect(screen.getByText("Delete selected node")).toBeInTheDocument();
    expect(screen.getByText("Del")).toBeInTheDocument();
    expect(screen.getByText("Edit selected node")).toBeInTheDocument();
  });

  it("shows empty selection state without a pipeline", () => {
    render(
      <PipelineCanvas
        canvasKey="test"
        nodes={[]}
        edges={[]}
        selectedPipeline={null}
        notice={null}
        onNoticeDismiss={() => undefined}
        onNodesChange={() => undefined}
        onEdgesChange={() => undefined}
        onConnect={() => undefined}
        onNodeSelect={() => undefined}
        onNodeOpen={() => undefined}
        onNodeDelete={() => undefined}
        onNodesDelete={() => undefined}
        onDrop={() => undefined}
        onDragOver={() => undefined}
        onDragLeave={() => undefined}
        onInit={() => undefined}
      />,
    );

    expect(screen.getByText("Select a pipeline to edit.")).toBeInTheDocument();
  });
});
