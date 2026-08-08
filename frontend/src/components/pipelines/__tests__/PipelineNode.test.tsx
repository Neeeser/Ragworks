import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { FlowPlaybackTimingContext } from "@/components/pipelines/flow/active-nodes-context";
import { PipelineNodeActionsProvider } from "@/components/pipelines/flow/node-actions-context";
import {
  DropPreviewNode,
  PipelineNode,
  pipelineNodeTypes,
  type DropPreviewNodeData,
  type PipelineNodeData,
} from "@/components/pipelines/PipelineNode";

import type { Node, NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";

const RETRIEVAL_RESULTS = "items";
const TARGET_RESULTS_TESTID = "target-results";
const STACKED_SOCKET_SELECTOR = '[data-socket="stacked"]';

vi.mock("@xyflow/react", () => ({
  Handle: ({
    id,
    type,
    className,
    "data-socket": dataSocket,
  }: {
    id: string;
    type: string;
    className?: string;
    "data-socket"?: string;
  }) => <div data-testid={`${type}-${id}`} data-socket={dataSocket} className={className} />,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  NodeToolbar: ({ children }: { children: ReactNode }) => (
    <div data-testid="node-toolbar">{children}</div>
  ),
  // The card reads the live zoom to decide whether the secondary role line is
  // still legible; at 1 it is.
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
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

const retrieverData: PipelineNodeData = {
  label: "Retriever",
  nodeType: "retriever.vector",
  inputs: [],
  outputs: [],
  config: {},
};

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
              requires: [],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
            {
              key: "request",
              label: "Request",
              data_type: "query_request",
              required: false,
              accepts_many: false,
              requires: [],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
          ],
          outputs: [
            {
              key: "embedded",
              label: "Embedded",
              data_type: "embedded_batch",
              required: false,
              accepts_many: false,
              requires: [],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
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
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("openai/text-embedding-3-small")).toBeInTheDocument();
    expect(screen.getByTestId("target-chunks")).toBeInTheDocument();
    expect(screen.getByTestId("source-embedded")).toBeInTheDocument();
  });

  it("renders variadic inputs as stacked sockets with a cardinality tooltip", () => {
    render(
      <PipelineNode
        {...nodeProps({
          label: "RRF Fusion",
          nodeType: "fusion.rrf",
          inputs: [
            {
              key: "results",
              label: "Results",
              data_type: RETRIEVAL_RESULTS,
              required: true,
              accepts_many: true,
              requires: ["score"],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
          ],
          outputs: [
            {
              key: "results",
              label: "Results",
              data_type: RETRIEVAL_RESULTS,
              required: true,
              accepts_many: false,
              requires: [],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
          ],
          config: {},
        })}
      />,
    );

    // "Results" is this node's own word for a stream three other nodes also
    // call Results while carrying a different type — the card names the type.
    expect(screen.getAllByText("Scored items").length).toBeGreaterThan(0);
    expect(screen.queryByText("Results")).not.toBeInTheDocument();
    // Required, and a fan-in: both marks, both spelled out in the legend.
    expect(screen.getByText("∗+")).toBeInTheDocument();
    const variadicRow = screen.getByTestId(TARGET_RESULTS_TESTID).parentElement;
    expect(variadicRow?.querySelectorAll(STACKED_SOCKET_SELECTOR)).toHaveLength(3);
    // Every port row explains itself; only the variadic one names the fan-in.
    const [variadicTooltip, outputTooltip] = screen.getAllByRole("tooltip");
    expect(variadicTooltip).toHaveTextContent(
      "Scored items · accepts many connections · required · needs score on every item",
    );
    expect(outputTooltip).toHaveTextContent("Items");
    expect(variadicTooltip.parentElement?.querySelectorAll(STACKED_SOCKET_SELECTOR)).toHaveLength(
      3,
    );

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
                data_type: RETRIEVAL_RESULTS,
                required: true,
                accepts_many: false,
                requires: [],
                adds: [],
                accepts: [],
                unaccepted: "passthrough" as const,
                preserves: false,
                removes: [],
              },
            ],
            outputs: [],
            config: {},
          },
          "node-2",
        )}
      />,
    );

    const single = screen
      .getAllByRole("tooltip")
      .find((node) => /accepts one connection/.test(node.textContent ?? ""));
    expect(single).toHaveTextContent("Items · accepts one connection · required");
    const singleRow = screen.getAllByTestId(TARGET_RESULTS_TESTID)[1].parentElement;
    expect(singleRow?.querySelector(STACKED_SOCKET_SELECTOR)).not.toBeInTheDocument();
  });

  it("positions port handles with live Tailwind v4 important utilities", () => {
    // Tailwind v4 only supports the trailing important flag (`absolute!`);
    // a leading `!absolute` generates no CSS, so the handle silently falls
    // back to xyflow's default black dot floating off the port row.
    render(
      <PipelineNode
        {...nodeProps({
          label: "RRF Fusion",
          nodeType: "fusion.rrf",
          inputs: [
            {
              key: "results",
              label: "Results",
              data_type: RETRIEVAL_RESULTS,
              required: true,
              accepts_many: true,
              requires: ["score"],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
          ],
          outputs: [
            {
              key: "out",
              label: "Results",
              data_type: RETRIEVAL_RESULTS,
              required: true,
              accepts_many: false,
              requires: [],
              adds: [],
              accepts: [],
              unaccepted: "passthrough" as const,
              preserves: false,
              removes: [],
            },
          ],
          config: {},
        })}
      />,
    );

    const input = screen.getByTestId(TARGET_RESULTS_TESTID);
    const output = screen.getByTestId("source-out");
    for (const handle of [input, output]) {
      const tokens = (handle.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
      expect(tokens.some((token) => token.startsWith("!"))).toBe(false);
      // Positioning and color must override xyflow's unlayered stylesheet.
      expect(tokens).toContain("absolute!");
      // xyflow's translate(±50%, -50%) must be cancelled or handles sit 6px
      // off their anchor (Tailwind v4 translate is a separate CSS property).
      expect(tokens).toContain("transform-none!");
      // The row must span the full column (the tooltip trigger is inline-flex,
      // which otherwise shrinks it to the label) so edge anchoring works.
      expect(handle.parentElement?.className).toContain("w-full");
      expect(tokens.some((token) => token.startsWith("bg-") && token.endsWith("!"))).toBe(true);
    }
    expect(input.getAttribute("class")).toContain("-left-[19px]!");
    expect(output.getAttribute("class")).toContain("-right-[19px]!");
  });

  it("hides at-default settings but counts edited ones", () => {
    const data: PipelineNodeData = {
      label: "Parser",
      nodeType: "parse.text",
      inputs: [],
      outputs: [],
      config: { encoding: "utf-8" },
      configSchema: {
        properties: {
          unknown_format: { type: "string", default: "skip" },
          encoding: { type: "string", default: "utf-8" },
        },
      },
    };

    const { rerender } = render(<PipelineNode {...nodeProps(data)} />);
    // encoding matches its default, so nothing hints at hidden settings.
    expect(screen.queryByText(/edited setting/)).not.toBeInTheDocument();
    expect(screen.queryByText("utf-8")).not.toBeInTheDocument();
    // The signature readout resolves the policy from the schema default.
    expect(screen.getByText("skip")).toBeInTheDocument();

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
      nodeType: "parse.text",
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

  it("shows Edit and Delete on a selected node, wired to the canvas actions", async () => {
    const user = userEvent.setup();
    const editNode = vi.fn();
    const deleteNode = vi.fn();

    render(
      <PipelineNodeActionsProvider value={{ editNode, deleteNode, deselectNode: vi.fn() }}>
        <PipelineNode {...nodeProps(retrieverData)} selected />
      </PipelineNodeActionsProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Edit node" }));
    await user.click(screen.getByRole("button", { name: "Delete node" }));

    expect(editNode).toHaveBeenCalledWith("node-1");
    expect(deleteNode).toHaveBeenCalledWith("node-1");
  });

  it("shows no toolbar on an unselected node", () => {
    render(
      <PipelineNodeActionsProvider
        value={{ editNode: vi.fn(), deleteNode: vi.fn(), deselectNode: vi.fn() }}
      >
        <PipelineNode {...nodeProps(retrieverData)} />
      </PipelineNodeActionsProvider>,
    );

    expect(screen.queryByRole("button", { name: "Delete node" })).not.toBeInTheDocument();
  });

  it("shows no toolbar where the canvas supplies no actions, as in a trace view", () => {
    render(<PipelineNode {...nodeProps(retrieverData)} selected />);

    expect(screen.queryByTestId("node-toolbar")).not.toBeInTheDocument();
  });

  it("exports pipeline node types", () => {
    expect(pipelineNodeTypes.pipelineNode).toBe(PipelineNode);
    expect(pipelineNodeTypes.dropPreview).toBe(DropPreviewNode);
  });
});
