import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { FlowPlaybackTimingContext } from "@/components/pipelines/flow/active-nodes-context";
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

  it("marks variadic inputs as (many) and single inputs with a one-connection tooltip", () => {
    render(
      <PipelineNode
        {...nodeProps({
          label: "RRF Fusion",
          nodeType: "fusion.rrf",
          inputs: [
            {
              key: "results",
              label: "Results",
              data_type: "retrieval_results",
              required: true,
              accepts_many: true,
            },
          ],
          outputs: [
            {
              key: "results",
              label: "Results",
              data_type: "retrieval_results",
              required: true,
              accepts_many: false,
            },
          ],
          config: {},
        })}
      />,
    );

    const variadic = screen.getByTitle(/accepts any number of connections/);
    expect(variadic).toHaveTextContent("Results (many)");
    // The output side carries no connection-cardinality claim.
    expect(screen.queryAllByTitle(/accepts any number/)).toHaveLength(1);

    render(
      <PipelineNode
        {...nodeProps(
          {
            label: "Result Limit",
            nodeType: "limit.results",
            inputs: [
              {
                key: "results",
                label: "Results",
                data_type: "retrieval_results",
                required: true,
                accepts_many: false,
              },
            ],
            outputs: [],
            config: {},
          },
          "node-2",
        )}
      />,
    );

    const single = screen.getByTitle(/accepts one connection/);
    expect(single).toHaveTextContent("Results");
    expect(single).not.toHaveTextContent("(many)");
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

  it("surrounds the active node with split progress beams paced by the playback clock", () => {
    const data: PipelineNodeData = {
      label: "Parser",
      nodeType: "parser.document",
      inputs: [],
      outputs: [],
      config: {},
    };

    const beamSelector = ".pipeline-node-beam";
    // Inactive: no beams at all — the light only surrounds the working box.
    const { container, rerender } = render(<PipelineNode {...nodeProps(data)} />);
    expect(container.querySelectorAll(beamSelector)).toHaveLength(0);

    // Active without a playback surface: the default process window paces
    // the flow, which splits into an over-the-top and an under-the-bottom
    // beam (each with a glow and a core stroke).
    rerender(<PipelineNode {...nodeProps({ ...data, active: true })} />);
    expect(container.querySelectorAll(beamSelector)).toHaveLength(4);
    expect(container.querySelectorAll(".pipeline-node-beam-over")).toHaveLength(2);
    expect(container.querySelectorAll(".pipeline-node-beam-under")).toHaveLength(2);
    container.querySelectorAll(beamSelector).forEach((beam) => {
      expect(beam).toHaveStyle({ animationDuration: "1250ms" });
      expect(beam).toHaveAttribute("pathLength", "1");
    });
    // Both routes share the entry and exit midpoints (`M x,y` … `L x,y`) so
    // the mirrored beams depart together and arrive together; the routes
    // between them differ (one over the top, one under the bottom).
    const overPath = container.querySelector(".pipeline-node-beam-over")?.getAttribute("d") ?? "";
    const underPath = container.querySelector(".pipeline-node-beam-under")?.getAttribute("d") ?? "";
    const endpoints = (d: string) => {
      const points = d.match(/-?[\d.]+,-?[\d.]+/g) ?? [];
      return { start: points.at(0), end: points.at(-1) };
    };
    expect(overPath).not.toEqual(underPath);
    expect(endpoints(overPath).start).toEqual(endpoints(underPath).start);
    expect(endpoints(overPath).end).toEqual(endpoints(underPath).end);

    // A playback surface's clock (e.g. the README capture's faster pace)
    // reaches the beams through the timing context.
    rerender(
      <FlowPlaybackTimingContext.Provider value={{ processMs: 550, processMsByNodeId: null }}>
        <PipelineNode {...nodeProps({ ...data, active: true })} />
      </FlowPlaybackTimingContext.Provider>,
    );
    container.querySelectorAll(beamSelector).forEach((beam) => {
      expect(beam).toHaveStyle({ animationDuration: "550ms" });
    });

    // A geometry-derived per-node duration wins over the fallback window, so
    // taller cards get a longer trip at the same light speed.
    rerender(
      <FlowPlaybackTimingContext.Provider
        value={{ processMs: 550, processMsByNodeId: new Map([["node-1", 820]]) }}
      >
        <PipelineNode {...nodeProps({ ...data, active: true })} />
      </FlowPlaybackTimingContext.Provider>,
    );
    container.querySelectorAll(beamSelector).forEach((beam) => {
      expect(beam).toHaveStyle({ animationDuration: "820ms" });
    });
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
