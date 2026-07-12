import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DropPreviewNode,
  PipelineNode,
  pipelineNodeTypes,
  type DropPreviewNodeData,
  type PipelineNodeData,
} from "@/components/pipelines/PipelineNode";

import type { Node, NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id: string; type: string }) => <div data-testid={`${type}-${id}`} />,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

const nodeProps = (data: PipelineNodeData, id = "node-1"): NodeProps<Node<PipelineNodeData>> => ({
  id,
  type: "pipelineNode",
  data,
  selected: false,
  selectable: true,
  deletable: true,
  draggable: true,
  dragging: false,
  zIndex: 0,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
});

describe("PipelineNode", () => {
  it("renders the signature readout, ports, and status", () => {
    render(
      <PipelineNode
        {...nodeProps({
          label: "Embedder",
          nodeType: "embedder.openrouter",
          inputs: [
            {
              key: "chunks",
              label: "Chunks",
              data_type: "chunk_batch",
              required: false,
              accepts_many: false,
            },
            {
              key: "request",
              label: "Request",
              data_type: "query_request",
              required: false,
              accepts_many: false,
            },
          ],
          outputs: [
            {
              key: "embedded",
              label: "Embedded",
              data_type: "embedded_batch",
              required: false,
              accepts_many: false,
            },
          ],
          config: { model_name: "openai/text-embedding-3-small" },
          status: "running",
          active: true,
        })}
      />,
    );

    expect(screen.getByText("Embedder")).toBeInTheDocument();
    expect(screen.getByText("Embedders")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("openai/text-embedding-3-small")).toBeInTheDocument();
    expect(screen.getByTestId("target-chunks")).toBeInTheDocument();
    expect(screen.getByTestId("source-embedded")).toBeInTheDocument();
  });

  it("hides at-default settings but counts edited ones", () => {
    const data: PipelineNodeData = {
      label: "Parser",
      nodeType: "parser.document",
      inputs: [],
      outputs: [],
      config: { encoding: "utf-8" },
      configSchema: {
        properties: {
          mode: { type: "string", default: "auto" },
          encoding: { type: "string", default: "utf-8" },
        },
      },
    };

    const { rerender } = render(<PipelineNode {...nodeProps(data)} />);
    // encoding matches its default, so nothing hints at hidden settings.
    expect(screen.queryByText(/edited setting/)).not.toBeInTheDocument();
    expect(screen.queryByText("utf-8")).not.toBeInTheDocument();
    // The signature readout resolves mode from the schema default.
    expect(screen.getByText("auto")).toBeInTheDocument();

    rerender(<PipelineNode {...nodeProps({ ...data, config: { encoding: "latin-1" } })} />);
    expect(screen.getByText("· 1 edited setting")).toBeInTheDocument();
    expect(screen.queryByText("latin-1")).not.toBeInTheDocument();
  });

  it("renders no readout for nodes without a signature", () => {
    render(
      <PipelineNode
        {...nodeProps({
          label: "Input",
          nodeType: "ingestion.input",
          inputs: [],
          outputs: [],
          config: undefined as unknown as Record<string, unknown>,
        })}
      />,
    );
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText(/edited setting/)).not.toBeInTheDocument();
  });
});

describe("DropPreviewNode", () => {
  it("renders default and custom labels", () => {
    const props = {
      id: "drop-1",
      type: "dropPreview",
      data: {},
      selected: false,
      selectable: false,
      deletable: false,
      draggable: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as NodeProps<Node<DropPreviewNodeData>>;

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
