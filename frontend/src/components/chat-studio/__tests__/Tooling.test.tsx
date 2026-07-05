import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  JsonBlock,
  ToolValue,
  ToolCallBubble,
  ToolChunkList,
  ToolKeyValueGrid,
  ToolPayloadSection,
  formatToolLabel,
} from "@/components/chat-studio/Tooling";
import * as apiModule from "@/lib/api";
import { makeTraceResponse } from "@/test/fixtures";
import { resetMockAuth, setMockAuth } from "@/test/mocks";

import type { PipelineTraceResponse } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

vi.mock("@/components/traces/PipelineTraceViewer", () => ({
  PipelineTraceViewer: ({
    trace,
    isOpen,
    onClose,
  }: {
    trace: PipelineTraceResponse | null;
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="trace-viewer">
        {trace?.run.id}
        <button type="button" onClick={onClose}>
          Close trace
        </button>
      </div>
    ) : null,
}));

describe("Tooling", () => {
  beforeEach(() => {
    resetMockAuth();
  });

  it("formats tool labels", () => {
    expect(formatToolLabel("")).toBe("Tool");
    expect(formatToolLabel("vector_store")).toBe("Vector Store");
    expect(formatToolLabel("web-search")).toBe("Web Search");
    expect(formatToolLabel("__")).toBe("Tool");
  });

  it("renders JsonBlock and key-value grids", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    render(
      <div>
        <JsonBlock data={{ ok: true }} />
        <JsonBlock data="raw" />
        <JsonBlock data={circular} />
        <ToolKeyValueGrid data={{ empty: "", skip: null }} />
        <ToolKeyValueGrid
          data={{
            name: "Doc",
            score: 3,
            flags: ["a", "b"],
            obj: { x: 1 },
            list: [{ x: 2 }],
            misc: () => "noop",
          }}
        />
        <ToolValue value={null} />
        <ToolValue value={[null, "ok"]} />
        <ToolValue value={Symbol("tool")} />
      </div>,
    );

    expect(screen.getAllByText(/ok/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("raw")).toBeInTheDocument();
    expect(screen.getByText(/No data available/)).toBeInTheDocument();
    expect(screen.getByText(/Doc/)).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Symbol(tool)")).toBeInTheDocument();
    expect(screen.getByText(/"x": 2/)).toBeInTheDocument();
  });

  it("toggles payload sections", () => {
    render(
      <ToolPayloadSection title="Section" description="Desc" collapsible defaultOpen={false}>
        <div>Body</div>
      </ToolPayloadSection>,
    );

    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Section/ }));
    expect(screen.getByText("Body")).toBeInTheDocument();
  }, 10000);

  it("renders non-collapsible payload sections", () => {
    render(
      <ToolPayloadSection title="Static" description="Desc">
        <div>Static body</div>
      </ToolPayloadSection>,
    );
    expect(screen.getByText("Static body")).toBeInTheDocument();
  });

  it("renders chunk lists and triggers trace selection", () => {
    const onSelectChunk = vi.fn();
    render(
      <ToolChunkList
        chunks={[
          "invalid",
          {
            chunk_id: "c1",
            document_id: "doc-1",
            text: "Chunk text",
            score: "0.5",
            order: 1,
            metadata: { a: 1 },
          },
          {
            id: "c2",
            text: "a".repeat(400),
            score: 0.1,
          },
          {
            text: 123,
            score: { value: 1 },
          },
        ]}
        activeChunkId="c1"
        onSelectChunk={onSelectChunk}
      />,
    );

    expect(screen.getByText(/Chunk 1/)).toBeInTheDocument();
    expect(screen.getByText(/Score 0.500/)).toBeInTheDocument();
    expect(screen.getByText("doc-1")).toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    expect(screen.queryByText("123")).not.toBeInTheDocument();
    const traceButtons = screen.getAllByRole("button", { name: /Trace chunk/ });
    fireEvent.click(traceButtons[0]);
    expect(onSelectChunk).toHaveBeenCalledWith("c1");
    fireEvent.click(traceButtons[2]);
    expect(onSelectChunk).toHaveBeenCalledWith("chunk-3");
  });

  it("shows empty chunk message", () => {
    render(<ToolChunkList chunks={[]} />);
    expect(screen.getByText(/No chunk data returned/)).toBeInTheDocument();
  });

  it("renders tool call bubble and loads traces", async () => {
    const trace = makeTraceResponse({
      run: {
        id: "trace-1",
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
      node_runs: [],
    });

    api.fetchQueryEventTrace.mockResolvedValueOnce(trace);

    render(
      <ToolCallBubble
        label="vector_search"
        variantClass=""
        args={{ query: "hello" }}
        response={{
          query_event_id: "q1",
          chunks: [{ chunk_id: "c1", text: "chunk text" }],
          query: "hello",
        }}
        rawPayload={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    expect(screen.getByText(/Retrieved chunks/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retrieval trace/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    await waitFor(() => {
      expect(api.fetchQueryEventTrace).toHaveBeenCalledWith("token", "q1");
    });
    expect(screen.getByTestId("trace-viewer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close trace" }));
  });

  it("surfaces an error when loading the trace fails", async () => {
    api.fetchQueryEventTrace.mockRejectedValueOnce(new Error("trace fetch failed"));

    render(
      <ToolCallBubble
        label="vector_search"
        variantClass=""
        args={{ query: "hello" }}
        response={{
          query_event_id: "q1",
          chunks: [{ chunk_id: "c1", text: "chunk text" }],
          query: "hello",
        }}
        rawPayload={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Retrieval trace/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));

    await waitFor(() => {
      expect(screen.getByText("trace fetch failed")).toBeInTheDocument();
    });
  });

  it("uses response metadata for tool summaries", () => {
    render(
      <ToolCallBubble
        label="meta"
        variantClass=""
        args={{ query: " " }}
        response={{ query: "From response" }}
        rawPayload={{}}
      />,
    );

    expect(screen.getByText("From response")).toBeInTheDocument();
  });

  it("uses chunk previews for tool summaries", () => {
    render(
      <ToolCallBubble
        label="chunk"
        variantClass=""
        args={{}}
        response={{ chunks: [{ text: "Chunk preview text" }] }}
        rawPayload={{}}
      />,
    );

    expect(screen.getByText("Chunk preview text")).toBeInTheDocument();
  });

  it("falls back to default tool summaries", () => {
    render(
      <ToolCallBubble label="fallback" variantClass="" args={{}} response={{}} rawPayload={{}} />,
    );

    expect(screen.getByText("View tool output")).toBeInTheDocument();
  });

  it("loads pipeline run traces when available", async () => {
    const trace = makeTraceResponse({
      run: {
        id: "trace-2",
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
      node_runs: [],
    });
    api.fetchPipelineRunTrace.mockResolvedValueOnce(trace);

    render(
      <ToolCallBubble
        label="pipeline"
        variantClass=""
        args={{}}
        response={{ pipeline_run_id: "run-1", chunks: [{ id: "c1", text: "chunk" }] }}
        rawPayload={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Retrieval trace/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));

    await waitFor(() => {
      expect(api.fetchPipelineRunTrace).toHaveBeenCalledWith("token", "run-1");
    });
  });

  it("handles missing tokens and response-only payloads", () => {
    setMockAuth({ token: null });

    render(
      <ToolCallBubble
        label="simple"
        variantClass=""
        args={{}}
        response={{ foo: "bar" }}
        rawPayload={{}}
        status="pending"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Response/ }));
    expect(screen.getByText("Foo")).toBeInTheDocument();
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("skips trace loads when unauthenticated", () => {
    setMockAuth({ token: null });
    render(
      <ToolCallBubble
        label="trace"
        variantClass=""
        args={{}}
        response={{ pipeline_run_id: "run-2", chunks: [{ id: "c1", text: "chunk" }] }}
        rawPayload={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Retrieval trace/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(api.fetchPipelineRunTrace).not.toHaveBeenCalled();
  });

  it("skips trace loads when trace metadata is missing", () => {
    render(
      <ToolCallBubble
        label="trace"
        variantClass=""
        args={{}}
        response={{ chunks: [{ id: "c1", text: "chunk" }] }}
        rawPayload={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Summary/ }));
    fireEvent.click(screen.getByRole("button", { name: /Retrieved chunks/ }));
    fireEvent.click(screen.getByRole("button", { name: /Trace chunk/ }));

    expect(api.fetchQueryEventTrace).not.toHaveBeenCalled();
    expect(api.fetchPipelineRunTrace).not.toHaveBeenCalled();
  });
});
