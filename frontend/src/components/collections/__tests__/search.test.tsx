"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSearch } from "@/components/collections/detail/CollectionSearch";
import * as apiModule from "@/lib/api";
import { makeCollectionTool, makeQueryResult } from "@/test/fixtures";
import { getMockRouter } from "@/test/test-utils";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const runQueryLabel = "Run query";
const viewTraceLabel = "Trace query";
const queryInputLabel = "Search query";
const firstQuery = "first question";
const traceResultLabel = "Trace result";
const previousResultText = "Previous result";

async function runQuery(text = "Find") {
  fireEvent.change(screen.getByLabelText(queryInputLabel), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
  });
}

describe("CollectionSearch", () => {
  it("disables the run button for empty queries", () => {
    render(<CollectionSearch collectionId="col-1" token="token" />);
    fireEvent.change(screen.getByLabelText(queryInputLabel), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: runQueryLabel })).toBeDisabled();
    expect(api.runCollectionQuery).not.toHaveBeenCalled();
  });

  it("runs queries, expands results, and navigates to traces", async () => {
    api.runCollectionQuery.mockResolvedValueOnce(
      makeQueryResult({
        query_event_id: "event-1",
        chunks: [
          {
            id: "chunk-1",
            chunk_id: "chunk-1",
            chunk_index: 0,
            score: 0.7,
            text: "Chunk text",
            metadata: { document_name: "guide.pdf" },
          },
          { id: "chunk-3", chunk_index: 2, score: 0.4, text: "Fallback id" },
        ],
      }),
    );
    render(<CollectionSearch collectionId="col-1" token="token" />);

    await runQuery();
    await waitFor(() => {
      expect(screen.getByText("Chunk text")).toBeInTheDocument();
    });
    expect(api.runCollectionQuery).toHaveBeenCalledWith("token", "col-1", {
      query: "Find",
      top_k: 5,
    });
    // The source document name comes from chunk metadata.
    expect(screen.getByText("guide.pdf")).toBeInTheDocument();
    expect(screen.getByText("Final score 0.700")).toBeInTheDocument();

    // Expand/collapse the full chunk text.
    const expand = screen.getAllByRole("button", { name: /Chunk text/ })[0];
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(expand).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByText(viewTraceLabel));
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/queries/event-1");

    fireEvent.click(screen.getAllByRole("button", { name: traceResultLabel })[0]);
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/queries/event-1?chunk=chunk-1");
    // Chunks without a chunk_id fall back to their row id.
    fireEvent.click(screen.getAllByRole("button", { name: traceResultLabel })[1]);
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/queries/event-1?chunk=chunk-3");
  });

  it("shows every returned match without a client-side score floor control", async () => {
    api.runCollectionQuery.mockResolvedValueOnce(
      makeQueryResult({
        query_event_id: "event-2",
        chunks: [
          { id: "c1", chunk_index: 0, score: 1.0, text: "Strong" },
          { id: "c2", chunk_index: 1, score: 0.2, text: "Weak" },
        ],
      }),
    );
    render(<CollectionSearch collectionId="col-1" token="token" />);
    await runQuery();

    await waitFor(() => {
      expect(screen.getByText("Strong")).toBeInTheDocument();
    });
    // Every match the pipeline returned is shown; truncation belongs to the
    // pipeline's Result Limit node, not a client-side slider.
    expect(screen.getByText("Weak")).toBeInTheDocument();
    expect(screen.getByText(/2 matches/)).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("remembers recent queries and re-runs them from chips", async () => {
    api.runCollectionQuery.mockResolvedValue(makeQueryResult({ chunks: [] }));
    render(<CollectionSearch collectionId="col-1" token="token" />);

    await runQuery(firstQuery);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: firstQuery })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(queryInputLabel), { target: { value: "other" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: firstQuery }));
    });
    expect(api.runCollectionQuery).toHaveBeenLastCalledWith("token", "col-1", {
      query: firstQuery,
      top_k: 5,
    });
  });

  it("announces a running query without clearing the previous results", async () => {
    api.runCollectionQuery.mockResolvedValueOnce(
      makeQueryResult({ chunks: [{ id: "old", score: 0.8, text: previousResultText }] }),
    );
    render(<CollectionSearch collectionId="col-1" token="token" />);
    await runQuery("first query");
    await waitFor(() => expect(screen.getByText(previousResultText)).toBeInTheDocument());

    let finishQuery: ((value: ReturnType<typeof makeQueryResult>) => void) | undefined;
    api.runCollectionQuery.mockReturnValueOnce(
      new Promise((resolve) => {
        finishQuery = resolve;
      }),
    );
    fireEvent.change(screen.getByLabelText(queryInputLabel), { target: { value: "next query" } });
    fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));

    expect(screen.getByRole("status")).toHaveTextContent("Running query…");
    expect(screen.getByText(previousResultText)).toBeInTheDocument();

    await act(async () => {
      finishQuery?.(makeQueryResult({ chunks: [] }));
    });
    expect(screen.queryByText("Running query…")).not.toBeInTheDocument();
  });

  it("surfaces query failures, with a fallback for non-error rejections", async () => {
    api.runCollectionQuery.mockRejectedValueOnce(new Error("Backend exploded"));
    render(<CollectionSearch collectionId="col-1" token="token" />);

    await runQuery();
    expect(screen.getByText("Backend exploded")).toBeInTheDocument();

    api.runCollectionQuery.mockRejectedValueOnce("nope");
    await runQuery("again");
    expect(screen.getByText("Query failed.")).toBeInTheDocument();
  });

  it("omits trace actions when the query has no event id", async () => {
    api.runCollectionQuery.mockResolvedValueOnce(
      makeQueryResult({
        query_event_id: undefined,
        chunks: [{ id: "c1", chunk_index: 0, score: 0.5, text: "Alpha" }],
      }),
    );
    render(<CollectionSearch collectionId="col-1" token="token" />);
    await runQuery();

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.queryByText(viewTraceLabel)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: traceResultLabel }));
    expect(getMockRouter().push).not.toHaveBeenCalled();
  });

  it("renders no retrieval control until the tools listing resolves", async () => {
    // Rendering the legacy Top K while the listing is in flight briefly
    // misrepresents a declaring tool (and vice versa).
    api.listCollectionTools.mockImplementationOnce(() => new Promise(() => {}));
    render(<CollectionSearch collectionId="col-pending" token="token" />);
    expect(screen.queryByText("Top K")).not.toBeInTheDocument();
    await act(async () => Promise.resolve());
  });

  it("falls back to the legacy control with a notice when the tools listing fails", async () => {
    api.listCollectionTools.mockRejectedValueOnce(new Error("tools down"));
    render(<CollectionSearch collectionId="col-err" token="token" />);
    await waitFor(() => {
      expect(screen.getByText(/load this collection/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Top K")).toBeInTheDocument();
  });

  it("offers a tool selector and runs the chosen tool's binding", async () => {
    api.listCollectionTools.mockResolvedValueOnce({
      tools: [
        makeCollectionTool({ id: "b-primary", name: "search_docs", is_primary: true }),
        makeCollectionTool({
          id: "b-count",
          name: "count_docs",
          is_primary: false,
          arguments: [],
        }),
      ],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce({
      kind: "chunks",
      tool_binding_id: "b-count",
      outputs: {},
      ...makeQueryResult({ chunks: [] }),
    });
    render(<CollectionSearch collectionId="col-selector" token="token" />);

    const selector = await screen.findByRole("combobox", { name: "Tool to run" });
    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole("option", { name: "count_docs" }));
    await runQuery("how many");

    expect(api.invokeCollectionTool).toHaveBeenCalledWith("token", "col-selector", "b-count", {
      query: "how many",
      top_k: 5,
    });
  });

  it("renders a structured tool result as labeled output fields", async () => {
    api.listCollectionTools.mockResolvedValueOnce({
      tools: [makeCollectionTool({ id: "b-count", name: "count_docs", is_primary: true })],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce({
      kind: "structured",
      tool_binding_id: "b-count",
      ...makeQueryResult({ chunks: [] }),
      outputs: { matching_documents: 42 },
    });
    render(<CollectionSearch collectionId="col-structured" token="token" />);
    await act(async () => Promise.resolve());

    await runQuery("how many mention aurora");

    expect(await screen.findByText("matching_documents")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText(/matches/)).not.toBeInTheDocument();
  });

  it("submits an explicitly selected false value for a required boolean argument", async () => {
    api.listCollectionTools.mockResolvedValueOnce({
      tools: [
        makeCollectionTool({
          id: "b-primary",
          is_primary: true,
          arguments: [
            {
              name: "include_archived",
              type: "boolean",
              description: "",
              required: true,
              default: null,
              minimum: null,
              maximum: null,
              choices: [],
              expose_to_llm: false,
            },
          ],
        }),
      ],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce({
      kind: "chunks",
      tool_binding_id: "b-primary",
      outputs: {},
      ...makeQueryResult({ chunks: [] }),
    });
    render(<CollectionSearch collectionId="col-required-bool" token="token" />);

    const booleanControl = await screen.findByRole("combobox", {
      name: "Argument include_archived",
    });
    fireEvent.change(screen.getByLabelText(queryInputLabel), { target: { value: "Find" } });
    fireEvent.click(booleanControl);
    fireEvent.click(screen.getByRole("option", { name: "false" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    expect(api.invokeCollectionTool).toHaveBeenCalledWith("token", "col-required-bool", "b-primary", {
      query: "Find",
      arguments: { include_archived: false },
    });
  });
});
