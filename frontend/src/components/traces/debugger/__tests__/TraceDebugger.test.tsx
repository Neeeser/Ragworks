import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceDebugger } from "@/components/traces/debugger/TraceDebugger";
import * as apiModule from "@/lib/api";
import { makeNodeRunTrace, makeTraceResponse } from "@/test/fixtures";

import type { PipelineTraceResponse } from "@/lib/types";

const routerBack = vi.fn();
const routerReplace = vi.fn();
const EXECUTION_ORDER_LABEL = "Execution order";
const CHUNK_ITEMS_LABEL = "Chunk items";
const FOCUSED_CHUNK_TEXT = "The focused chunk text.";
const INGESTED_CHUNK_TEXT = "The ingested chunk body.";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "test-token" }),
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: routerBack, push: vi.fn(), replace: routerReplace }),
}));

let lastReactFlowProps: Record<string, unknown> | null = null;
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    lastReactFlowProps = props;
    return <div data-testid="reactflow" />;
  },
  Background: () => <div data-testid="background" />,
  Handle: () => <div />,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BaseEdge: () => <div />,
  getBezierPath: () => ["M0 0"],
}));

const api = vi.mocked(apiModule);

function makeTwoNodeTrace(overrides: Partial<PipelineTraceResponse> = {}): PipelineTraceResponse {
  const base = makeTraceResponse();
  return {
    ...base,
    definition: {
      nodes: [
        { id: "n1", type: "parser.text", name: "Parse", config: {}, position: { x: 0, y: 0 } },
        {
          id: "n2",
          type: "chunker.token",
          name: "Chunk",
          config: {},
          position: { x: 100, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2", source_port: "out", target_port: "in" }],
      viewport: {},
    },
    node_runs: [
      makeNodeRunTrace({
        id: "nr1",
        node_id: "n1",
        node_type: "parser.text",
        node_name: "Parse",
        sequence_index: 0,
        summary: {
          inputs: [{ label: "Source", value: "file.pdf", kind: "text" }],
          outputs: [
            {
              label: "Chunks",
              value: {
                count: 1,
                samples: [{ chunk_id: "chunk-7", order: 7, preview: "focused chunk" }],
                document_id: "doc-1",
              },
              kind: "json",
            },
            {
              label: CHUNK_ITEMS_LABEL,
              value: { kind: "chunks", items: [{ id: "chunk-7", score: null }] },
              kind: "items",
            },
          ],
        },
      }),
      makeNodeRunTrace({
        id: "nr2",
        node_id: "n2",
        node_type: "chunker.token",
        node_name: "Chunk",
        sequence_index: 1,
        summary: {
          inputs: [
            {
              label: CHUNK_ITEMS_LABEL,
              value: { kind: "chunks", items: [{ id: "chunk-7", score: null }] },
              kind: "items",
            },
          ],
          outputs: [
            { label: "Chunks", value: "42 chunks", kind: "text" },
            {
              label: "Embedded items",
              value: { kind: "chunks", items: [{ id: "chunk-7", score: null }] },
              kind: "items",
            },
          ],
        },
      }),
    ],
    ...overrides,
  };
}

describe("TraceDebugger", () => {
  beforeEach(() => {
    lastReactFlowProps = null;
    routerReplace.mockReset();
  });

  it("shows the error state with a way back when the trace cannot load", async () => {
    api.fetchDocumentTrace.mockRejectedValueOnce(new Error("Trace not found."));

    render(<TraceDebugger source={{ kind: "document", id: "doc-x", chunkId: null }} />);

    await waitFor(() => expect(screen.getByText("Trace not found.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(routerBack).toHaveBeenCalled();
  });

  it("renders the compact graph, execution order, and node evidence once the trace loads", async () => {
    api.fetchPipelineRunTrace.mockResolvedValueOnce(makeTwoNodeTrace());

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);

    await waitFor(() => expect(screen.getByTestId("reactflow")).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Trace graph" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: EXECUTION_ORDER_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Node evidence" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    expect(screen.getByText("focused chunk")).toBeInTheDocument();
    expect(screen.queryByText("file.pdf")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Input Source" }));
    expect(screen.getByText("file.pdf")).toBeInTheDocument();
    expect(screen.queryByText(CHUNK_ITEMS_LABEL)).not.toBeInTheDocument();
  });

  it("changes node evidence from the execution order", async () => {
    api.fetchPipelineRunTrace.mockResolvedValueOnce(makeTwoNodeTrace());

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);
    await waitFor(() => expect(screen.getByTestId("reactflow")).toBeInTheDocument());

    const stepRail = screen.getByRole("navigation", { name: EXECUTION_ORDER_LABEL });
    fireEvent.click(within(stepRail).getByRole("button", { name: "Execution step Chunk" }));
    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    expect(screen.getByText("42 chunks")).toBeInTheDocument();
    expect(screen.queryByText("file.pdf")).not.toBeInTheDocument();
  });

  it("selects graph evidence without changing focused trace state", async () => {
    api.fetchPipelineRunTrace.mockResolvedValueOnce(makeTwoNodeTrace());

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);
    await waitFor(() => expect(lastReactFlowProps).not.toBeNull());

    act(() => {
      (lastReactFlowProps?.onNodeClick as (event: unknown, node: { id: string }) => void)(null, {
        id: "n2",
      });
    });
    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    expect(screen.getByText("42 chunks")).toBeInTheDocument();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("opens a failed run on its first failed node", async () => {
    const trace = makeTwoNodeTrace();
    trace.run = { ...trace.run, status: "failed" };
    trace.node_runs = [
      trace.node_runs[0],
      { ...trace.node_runs[1], status: "failed", error_message: "Embedding blew up" },
    ];
    api.fetchPipelineRunTrace.mockResolvedValueOnce(trace);

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);

    await waitFor(() => expect(screen.getByText("Embedding blew up")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    expect(screen.getByText("42 chunks")).toBeInTheDocument();
  });

  it("seeds focus from a chunk deep link and opens its content in the artifact drawer", async () => {
    api.fetchQueryEventEndToEndTrace.mockResolvedValueOnce({
      retrieval: makeTwoNodeTrace(),
      origin: null,
      context_items: [],
      focused_item: {
        id: "chunk-7",
        status: "resolved",
        text: FOCUSED_CHUNK_TEXT,
        document_id: "doc-1",
        filename: "paper.pdf",
        chunk_index: 7,
        chunk_count: 42,
      },
    });

    render(<TraceDebugger source={{ kind: "query", id: "qe-1", chunkId: "chunk-7" }} />);

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Focused result" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(FOCUSED_CHUNK_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText("paper.pdf")).toBeInTheDocument();
    expect(screen.getByText("Chunk 8 of 42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open focused chunk" }));
    const drawer = screen.getByRole("dialog", { name: "paper.pdf · Chunk 8 of 42" });
    expect(within(drawer).getByRole("complementary")).toHaveClass("h-[calc(100dvh-5rem)]");
    expect(within(drawer).getByText(FOCUSED_CHUNK_TEXT)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Close artifact" }));
    expect(
      screen.queryByRole("dialog", { name: "paper.pdf · Chunk 8 of 42" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: EXECUTION_ORDER_LABEL })).toBeInTheDocument();
    expect(lastReactFlowProps?.centerNodeId).toBeUndefined();

    const nodes = lastReactFlowProps?.nodes as Array<{
      id: string;
      data: { itemFocus?: string };
    }>;
    const edges = lastReactFlowProps?.edges as Array<{
      id: string;
      data: { itemFocus?: string };
    }>;
    expect(nodes.find((node) => node.id === "n1")?.data.itemFocus).toBe("traveled");
    expect(nodes.find((node) => node.id === "n2")?.data.itemFocus).toBe("traveled");
    expect(edges.find((edge) => edge.id === "e1")?.data.itemFocus).toBe("traveled");
  });

  it("traces an explicit result without replacing node evidence selection", async () => {
    api.fetchPipelineRunTrace.mockResolvedValueOnce(makeTwoNodeTrace());

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);
    await waitFor(() => expect(screen.getByTestId("reactflow")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect result chunk-7" }));
    fireEvent.click(screen.getByRole("button", { name: "Trace this result chunk-7" }));
    const timeline = screen.getByRole("navigation", { name: EXECUTION_ORDER_LABEL });
    expect(routerReplace).toHaveBeenCalledWith("/traces/runs/run-1?chunk=chunk-7");
    expect(
      (lastReactFlowProps?.nodes as Array<{ id: string; data: { itemFocus?: string } }>).find(
        (node) => node.id === "n1",
      )?.data.itemFocus,
    ).toBe("traveled");

    fireEvent.click(within(timeline).getByRole("button", { name: "Execution step Chunk" }));
    fireEvent.click(screen.getByRole("tab", { name: "Node data" }));
    expect(screen.getByText("42 chunks")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit focused trace" }));
    expect(screen.queryByRole("region", { name: "Focused result" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: EXECUTION_ORDER_LABEL })).toBeInTheDocument();
    expect(routerReplace).toHaveBeenLastCalledWith("/traces/runs/run-1");
  });

  it("labels a Files-page chunk trace as ingestion-only and opens its artifact", async () => {
    const trace = makeTwoNodeTrace();
    trace.run = { ...trace.run, kind: "ingestion" };
    api.fetchDocumentFocusedTrace.mockResolvedValueOnce({
      trace,
      context_items: [],
      focused_item: {
        id: "chunk-7",
        status: "resolved",
        text: INGESTED_CHUNK_TEXT,
        document_id: "doc-1",
        filename: "doc.pdf",
        chunk_index: 7,
        chunk_count: 30,
      },
    });

    render(<TraceDebugger source={{ kind: "document", id: "doc-1", chunkId: "chunk-7" }} />);

    await waitFor(() => expect(screen.getByText("Focused chunk")).toBeInTheDocument());
    expect(screen.queryByText(INGESTED_CHUNK_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText(/covers ingestion only/)).toBeInTheDocument();
    expect(screen.queryByText(/Chunk text unavailable/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open focused chunk" }));
    expect(screen.getByText(INGESTED_CHUNK_TEXT)).toBeInTheDocument();
  });

  it("offers a refresh for a still-running trace and refetches on click", async () => {
    const running = makeTwoNodeTrace();
    running.run = { ...running.run, status: "running", completed_at: null };
    api.fetchPipelineRunTrace.mockResolvedValue(running);

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);
    await waitFor(() => expect(screen.getByTestId("reactflow")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(api.fetchPipelineRunTrace).toHaveBeenCalledTimes(2));
  });

  it("surfaces the node-spec notice without blocking the trace", async () => {
    api.fetchPipelineNodes.mockRejectedValueOnce(new Error("boom"));
    api.fetchPipelineRunTrace.mockResolvedValueOnce(makeTwoNodeTrace());

    render(<TraceDebugger source={{ kind: "run", id: "run-1", chunkId: null }} />);

    await waitFor(() =>
      expect(screen.getByText(/Node details are unavailable/)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });
});
