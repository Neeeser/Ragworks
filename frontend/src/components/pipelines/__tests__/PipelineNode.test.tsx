import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  DropPreviewNode,
  PipelineNode,
  pipelineNodeTypes,
  type DropPreviewNodeData,
  type PipelineNodeData,
} from "@/components/pipelines/PipelineNode";

import type { NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id: string; type: string }) => <div data-testid={`${type}-${id}`} />,
  Position: { Top: "top", Bottom: "bottom" },
}));

const parserNodeType = "parser.document";

describe("PipelineNode", () => {
  it("renders node content with config values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const props: NodeProps<PipelineNodeData> = {
      id: "node-1",
      data: {
        label: "Node",
        nodeType: parserNodeType,
        description: "Desc",
        example: { input: "In", output: "Out" },
        inputs: [
          { key: "in", label: "In", data_type: "document", required: true },
          { key: "opt", label: "Optional", data_type: "text", required: false },
        ],
        outputs: [{ key: "out", label: "Out", data_type: "document", required: false }],
        config: {
          long: "x".repeat(80),
          count: 2,
          enabled: false,
          empty: null,
          circular,
          meta: { foo: "bar" },
          missing: undefined,
        },
        status: "running",
        active: true,
      },
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      xPos: 0,
      yPos: 0,
    };

    render(<PipelineNode {...props} />);

    expect(screen.getByText("Node")).toBeInTheDocument();
    expect(screen.getByText(parserNodeType)).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
    expect(screen.getByTestId("target-in")).toBeInTheDocument();
    expect(screen.getByTestId("source-out")).toBeInTheDocument();
  });

  it("renders default config entries when config is empty", () => {
    const props: NodeProps<PipelineNodeData> = {
      id: "node-2",
      data: {
        label: "Defaults",
        nodeType: parserNodeType,
        inputs: [],
        outputs: [],
        config: {},
        configSchema: {
          properties: {
            depth: { type: "integer", default: 3 },
            mode: { type: "string" },
          },
        },
      },
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      xPos: 0,
      yPos: 0,
    };

    render(<PipelineNode {...props} />);
    expect(screen.getByText("depth")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("mode")).not.toBeInTheDocument();
  });

  it("handles empty config without defaults", () => {
    const props: NodeProps<PipelineNodeData> = {
      id: "node-3",
      data: {
        label: "Empty",
        nodeType: parserNodeType,
        inputs: [],
        outputs: [],
        config: undefined as unknown as Record<string, unknown>,
        configSchema: {},
      },
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: true,
      xPos: 0,
      yPos: 0,
    };

    render(<PipelineNode {...props} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});

describe("DropPreviewNode", () => {
  it("renders default and custom labels", () => {
    const props = {
      id: "drop-1",
      data: {},
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      xPos: 0,
      yPos: 0,
    } as NodeProps<DropPreviewNodeData>;

    const { rerender } = render(<DropPreviewNode {...props} />);
    expect(screen.getByText("Drop here")).toBeInTheDocument();

    rerender(<DropPreviewNode {...props} data={{ label: "Add" }} />);
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("exports pipeline node types", () => {
    expect(pipelineNodeTypes.pipelineNode).toBe(PipelineNode);
    expect(pipelineNodeTypes.dropPreview).toBe(DropPreviewNode);
  });
});
