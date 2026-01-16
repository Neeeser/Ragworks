import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineTraceViewer } from "@/components/traces/PipelineTraceViewer";

import type { PipelineTraceResponse } from "@/lib/types";

const api = {
  fetchPipelineNodes: vi.fn(),
};

let lastReactFlowProps: Record<string, unknown> | null = null;
const baseTimestamp = "2024-01-01T00:00:00.000Z";
const runId = "run-1";
const ingestionNodeType = "ingestion.input";
const indexerNodeType = "indexer.pinecone";
const nodeOneId = "n1";
const nodeTwoId = "n2";

vi.mock("@/lib/api", () => ({
  fetchPipelineNodes: (...args: unknown[]) => api.fetchPipelineNodes(...args),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    lastReactFlowProps = props;
    const TraceCursor = (props.nodeTypes as { traceCursor?: React.FC } | undefined)?.traceCursor;
    return <div data-testid="reactflow">{TraceCursor ? <TraceCursor /> : null}</div>;
  },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
}));

const trace: PipelineTraceResponse = {
  run: {
    id: runId,
    status: "completed",
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
    {
      id: "nr1",
      run_id: runId,
      node_id: nodeOneId,
      node_type: ingestionNodeType,
      node_name: "Input",
      sequence_index: 0,
      status: "success",
      started_at: baseTimestamp,
      completed_at: baseTimestamp,
      summary: {
        inputs: [{ label: "Query", value: { chunk_id: "chunk-1", text: "hello" }, kind: "text" }],
        outputs: [{ label: "Score", value: 3, kind: "value" }],
      },
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
    {
      id: "nr2",
      run_id: runId,
      node_id: nodeTwoId,
      node_type: indexerNodeType,
      node_name: "Index",
      sequence_index: 1,
      status: "success",
      started_at: baseTimestamp,
      completed_at: baseTimestamp,
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
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
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
};

describe("PipelineTraceViewer", () => {
  beforeEach(() => {
    api.fetchPipelineNodes.mockReset();
    api.fetchPipelineNodes.mockResolvedValue([
      {
        type: ingestionNodeType,
        label: "Input",
        category: "ingestion",
        description: "",
        example: "",
        input_ports: [],
        output_ports: [],
        config_schema: {},
        default_config: {},
      },
      {
        type: indexerNodeType,
        label: "Index",
        category: "ingestion",
        description: "",
        example: "",
        input_ports: [],
        output_ports: [],
        config_schema: {},
        default_config: {},
      },
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

    act(() => {
      (lastReactFlowProps?.onNodeClick as (event: unknown, node: { id: string }) => void)?.(null, {
        id: nodeTwoId,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Step/ }));
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
    fireEvent.click(screen.getByRole("button", { name: "Play trace" }));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole("button", { name: "Play trace" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("focuses neighboring nodes when initializing the flow", async () => {
    const fitView = vi.fn();
    render(<PipelineTraceViewer trace={trace} token="token" isOpen onClose={() => undefined} />);

    await waitFor(() => {
      expect(lastReactFlowProps).not.toBeNull();
      expect(api.fetchPipelineNodes).toHaveBeenCalled();
    });

    act(() => {
      (lastReactFlowProps?.onInit as ((instance: { fitView: () => void }) => void) | undefined)?.({
        fitView,
      });
    });

    await waitFor(() => {
      expect(fitView).toHaveBeenCalled();
    });
  });

  it("plays trace and advances steps", () => {
    vi.useFakeTimers();
    render(<PipelineTraceViewer trace={trace} token="token" isOpen onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /Play trace/ }));

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    vi.useRealTimers();
  });

  it("handles fetch errors", async () => {
    api.fetchPipelineNodes.mockRejectedValueOnce(new Error("boom"));
    render(<PipelineTraceViewer trace={trace} token="token" isOpen onClose={() => undefined} />);
    await waitFor(() => {
      expect(api.fetchPipelineNodes).toHaveBeenCalled();
    });
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
          payload: [{ item: { chunk_id: "chunk-1" } }, { item: { chunk_id: "chunk-2" } }],
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
});
