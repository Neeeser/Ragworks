import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineTraceViewer } from "@/components/traces/PipelineTraceViewer";
import * as apiModule from "@/lib/api";
import { makeNodeRunTrace, makeNodeSpec, makeTraceResponse } from "@/test/fixtures";

import type { PipelineTraceResponse } from "@/lib/types";

let lastReactFlowProps: Record<string, unknown> | null = null;
const baseTimestamp = "2024-01-01T00:00:00.000Z";
const runId = "run-1";
const ingestionNodeType = "ingestion.input";
const indexerNodeType = "indexer.pinecone";
const nodeOneId = "n1";
const nodeTwoId = "n2";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "context-token" }),
);

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    lastReactFlowProps = props;
    return <div data-testid="reactflow" />;
  },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Handle: () => <div />,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BaseEdge: () => <div />,
  getBezierPath: () => ["M0 0"],
}));

const trace: PipelineTraceResponse = makeTraceResponse({
  run: {
    id: runId,
    kind: "ingestion",
    user_id: "user-1",
    collection_id: "col-1",
    status: "completed",
    started_at: baseTimestamp,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    pipeline_id: "pipe-1",
    pipeline_version: 1,
  },
  definition: {
    nodes: [
      {
        id: nodeOneId,
        type: ingestionNodeType,
        name: "Input",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: nodeTwoId,
        type: indexerNodeType,
        name: "Index",
        config: {},
        position: { x: 100, y: 100 },
      },
    ],
    edges: [
      {
        id: "e1",
        source: nodeOneId,
        target: nodeTwoId,
        source_port: "source",
        target_port: "source",
      },
    ],
    viewport: {},
  },
  node_runs: [
    makeNodeRunTrace({
      id: "nr1",
      node_id: nodeOneId,
      node_type: ingestionNodeType,
      node_name: "Input",
      sequence_index: 0,
      summary: {
        inputs: [{ label: "Query", value: { chunk_id: "chunk-1", text: "hello" }, kind: "text" }],
        outputs: [{ label: "Score", value: 3, kind: "value" }],
      },
    }),
    makeNodeRunTrace({
      id: "nr2",
      node_id: nodeTwoId,
      node_type: indexerNodeType,
      node_name: "Index",
      sequence_index: 1,
      summary: {
        inputs: [
          {
            label: "Embedding",
            value: { count: 2, dimension: 3, preview: "short", full: "long" },
            kind: "embedding",
          },
        ],
        outputs: [
          {
            label: "Payload",
            value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
          },
        ],
      },
    }),
  ],
  node_io: [
    {
      id: "io-1",
      run_id: runId,
      node_run_id: "nr1",
      node_id: nodeOneId,
      io_type: "input",
      port: "input",
      payload: {
        chunk_id: "chunk-1",
        text: "hello",
        nested: {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: { value: "deep" },
                },
              },
            },
          },
        },
      },
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
    {
      id: "io-2",
      run_id: runId,
      node_run_id: "nr1",
      node_id: nodeOneId,
      io_type: "output",
      port: "output",
      payload: { value: "done" },
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
  ],
});

const api = vi.mocked(apiModule);

describe("PipelineTraceViewer", () => {
  beforeEach(() => {
    api.fetchPipelineNodes.mockResolvedValue([
      makeNodeSpec({
        type: ingestionNodeType,
        label: "Input",
        category: "ingestion",
        description: "",
        input_ports: [],
        output_ports: [],
      }),
      makeNodeSpec({
        type: indexerNodeType,
        label: "Index",
        category: "ingestion",
        description: "",
        input_ports: [],
        output_ports: [],
      }),
    ]);
  });

  it("returns null when closed", () => {
    const { container } = render(
      <PipelineTraceViewer trace={null} token="token" isOpen={false} onClose={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders trace and toggles payloads", async () => {
    const onClose = vi.fn();
    render(
      <PipelineTraceViewer
        trace={trace}
        token="token"
        isOpen
        onClose={onClose}
        highlightChunkId="chunk-1"
      />,
    );

    expect(screen.getByText(/Pipeline trace/)).toBeInTheDocument();
    expect(screen.getByText(/Inputs/)).toBeInTheDocument();

    await waitFor(() => {
      expect(api.fetchPipelineNodes).toHaveBeenCalled();
    });

    const toggleButtons = screen.getAllByRole("button", { name: /Show full payloads/ });
    fireEvent.click(toggleButtons[0]);
    fireEvent.click(toggleButtons[1]);
    expect(screen.getAllByText(/Full payloads/).length).toBeGreaterThan(0);

    const hideButtons = screen.getAllByRole("button", { name: /Hide full payloads/ });
    fireEvent.click(hideButtons[0]);
    fireEvent.click(hideButtons[1]);
    expect(screen.queryByText(/Full payloads/)).not.toBeInTheDocument();

    fireEvent.click(toggleButtons[0]);
    const expandButtons = screen.getAllByRole("button", { name: /Expand/ });
    expandButtons.forEach((button) => fireEvent.click(button));
    expect(screen.getAllByText(/Collapse/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Close/ }));
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("Index")).toBeInTheDocument();
  });

  it("renders text summaries and finishes playback", async () => {
    const textTrace: PipelineTraceResponse = {
      ...trace,
      node_runs: [
        {
          ...trace.node_runs[0],
          summary: {
            inputs: [{ label: "Query", value: "hello world", kind: "text" }],
            outputs: [{ label: "Score", value: 3, kind: "value" }],
          },
        },
        trace.node_runs[1],
      ],
    };

    render(
      <PipelineTraceViewer trace={textTrace} token="token" isOpen onClose={() => undefined} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Pipeline trace/)).toBeInTheDocument();
    });

    expect(screen.getByText(/length/)).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play pipeline" }));
      expect(screen.getByRole("button", { name: "Pause playback" })).toBeInTheDocument();

      // Each act flushes one playback phase (process -> travel -> ...); the
      // chain schedules its next timer only after effects run.
      for (let i = 0; i < 6; i += 1) {
        act(() => {
          vi.advanceTimersByTime(1100);
        });
      }

      // Playback pauses itself after the last step.
      expect(screen.getByRole("button", { name: "Play pipeline" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fits the whole graph once instead of chasing the active node", async () => {
    render(<PipelineTraceViewer trace={trace} token="token" isOpen onClose={() => undefined} />);

    await waitFor(() => {
      expect(lastReactFlowProps).not.toBeNull();
    });

    expect(lastReactFlowProps?.fitView).toBe(true);
    expect(lastReactFlowProps?.nodesDraggable).toBe(false);
  });

  it("handles fetch errors by surfacing a non-blocking notice", async () => {
    api.fetchPipelineNodes.mockRejectedValueOnce(new Error("boom"));
    render(<PipelineTraceViewer trace={trace} token="token" isOpen onClose={() => undefined} />);
    await waitFor(() => {
      expect(api.fetchPipelineNodes).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText(/Node details are unavailable right now/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });

  it("highlights chunk ids and previews array payloads", () => {
    const highlightedTrace: PipelineTraceResponse = {
      ...trace,
      node_runs: [
        {
          ...trace.node_runs[0],
          summary: {
            inputs: [
              {
                label: "Chunk",
                kind: "text",
                value: { meta: { chunk_id: "chunk-1" } },
              },
            ],
            outputs: [],
          },
        },
      ],
      node_io: [
        {
          ...trace.node_io[0],
          // Real payloads can also be arrays; containsChunkId() traverses either shape,
          // so this exercises that path even though the declared type is object-shaped.
          payload: [
            { item: { chunk_id: "chunk-1" } },
            { item: { chunk_id: "chunk-2" } },
          ] as unknown as Record<string, unknown>,
        },
      ],
    };

    render(
      <PipelineTraceViewer
        trace={highlightedTrace}
        token="token"
        isOpen
        highlightChunkId="chunk-1"
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("chunk chunk-1")).toBeInTheDocument();
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });

  it("renders empty IO summaries and payload fallbacks", async () => {
    const emptyTrace: PipelineTraceResponse = {
      ...trace,
      node_runs: [
        {
          ...trace.node_runs[0],
          summary: { inputs: [], outputs: [] },
        },
      ],
      node_io: [],
    };

    render(
      <PipelineTraceViewer trace={emptyTrace} token="token" isOpen onClose={() => undefined} />,
    );

    expect(screen.getByText("No primary inputs recorded.")).toBeInTheDocument();
    expect(screen.getByText("No primary outputs recorded.")).toBeInTheDocument();

    const showButtons = screen.getAllByRole("button", { name: /Show full payloads/ });
    fireEvent.click(showButtons[0]);
    fireEvent.click(showButtons[1]);

    expect(screen.getByText("No inputs recorded.")).toBeInTheDocument();
    expect(screen.getByText("No outputs recorded.")).toBeInTheDocument();
  });

  it("renders text summary previews and scalar strings", () => {
    const summaryTrace: PipelineTraceResponse = {
      ...trace,
      node_runs: [
        {
          ...trace.node_runs[0],
          summary: {
            inputs: [
              {
                label: "Notes",
                kind: "text",
                value: { preview: "Short preview", full: "Full text", length: 20 },
              },
            ],
            outputs: [
              {
                label: "Status",
                kind: "value",
                value: "Scalar string",
              },
            ],
          },
        },
      ],
    };

    render(
      <PipelineTraceViewer trace={summaryTrace} token="token" isOpen onClose={() => undefined} />,
    );

    expect(screen.getByText("Short preview")).toBeInTheDocument();
    expect(screen.getByText(/length 20/)).toBeInTheDocument();
    expect(screen.getByText("Scalar string")).toBeInTheDocument();
  });

  it("falls back to the auth context token when no token prop is given", async () => {
    render(<PipelineTraceViewer trace={trace} isOpen onClose={() => undefined} />);

    await waitFor(() => {
      expect(api.fetchPipelineNodes).toHaveBeenCalledWith("context-token");
    });
  });

  it("skips fetching node specs when they are provided directly", () => {
    render(
      <PipelineTraceViewer
        trace={trace}
        token="token"
        nodeSpecs={[]}
        isOpen
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText(/Pipeline trace/)).toBeInTheDocument();
    expect(api.fetchPipelineNodes).not.toHaveBeenCalled();
  });
});
