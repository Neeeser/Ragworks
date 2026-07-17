import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolCallBubble } from "@/components/chat-studio/Tooling";
import {
  JsonBlock,
  ToolValue,
  ToolChunkList,
  ToolKeyValueGrid,
  ToolPayloadSection,
  formatToolLabel,
} from "@/components/chat-studio/ToolPayloadPrimitives";
import { resetMockAuth, setMockAuth } from "@/test/mocks";
import { getMockRouter } from "@/test/test-utils";

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

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

  it("renders tool call bubble and navigates to the query trace", () => {
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
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/queries/q1");
  });

  it("shows the model tool-call object separately from retrieval output", () => {
    render(
      <ToolCallBubble
        label="Search My first collection"
        variantClass=""
        args={{ query: "evaluation results" }}
        response={{ chunks: [] }}
        rawPayload={{
          model_tool_call: {
            id: "call-1",
            type: "function",
            function: {
              name: "search_my_first_collection",
              arguments: '{"query":"evaluation results"}',
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByText("Summary"));

    const modelToolCall = screen.getByText("Model tool call").closest("details");
    expect(modelToolCall).toHaveTextContent("search_my_first_collection");
  });

  it("navigates to a chunk-targeted trace from the chunk list", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Retrieved chunks/ }));
    fireEvent.click(screen.getByRole("button", { name: /Trace chunk/ }));
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/queries/q1?chunk=c1");
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

  it("falls back to the pipeline-run trace route when there is no query event", () => {
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

    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/runs/run-1");
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

  it("does not navigate when trace metadata is missing", () => {
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

    expect(getMockRouter().push).not.toHaveBeenCalled();
  });
});
