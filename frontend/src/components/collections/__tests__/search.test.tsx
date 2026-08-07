"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSearch } from "@/components/collections/detail/CollectionSearch";
import * as apiModule from "@/lib/api";
import { makeCollectionTool, makeQueryResult } from "@/test/fixtures";
import { getMockRouter } from "@/test/test-utils";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
// The composer's image attach reads the upload size cap from app config.
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

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
    expect(screen.getByText("0.700")).toBeInTheDocument();

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
    // The count is mono with its unit as a muted span inside it, so the match
    // is on the whole cell's text rather than a single text node.
    expect(
      screen.getByText((_text, element) => element?.textContent === "2 matches"),
    ).toBeInTheDocument();
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

    // The pulse is the running indicator, and it names the process it depicts.
    expect(screen.getByRole("status", { name: "Running query" })).toBeInTheDocument();
    expect(screen.getByText(previousResultText)).toBeInTheDocument();

    await act(async () => {
      finishQuery?.(makeQueryResult({ chunks: [] }));
    });
    // It stops the moment the query does — an idle pulse would be a lie.
    expect(screen.queryByRole("status", { name: "Running query" })).not.toBeInTheDocument();
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
    // The per-result action disappears too — a rendered button whose click
    // opens nothing is the bug, not a state to pin.
    expect(screen.queryByRole("button", { name: traceResultLabel })).not.toBeInTheDocument();
    expect(getMockRouter().push).not.toHaveBeenCalled();
  });

  it("renders no retrieval control until the tools listing resolves", async () => {
    // Rendering the legacy Top K while the listing is in flight briefly
    // misrepresents a declaring tool (and vice versa).
    api.listCollectionTools.mockImplementationOnce(() => new Promise(() => {}));
    render(<CollectionSearch collectionId="col-pending" token="token" />);
    expect(screen.queryByText("top_k")).not.toBeInTheDocument();
    await act(async () => Promise.resolve());
  });

  it("falls back to the legacy control with a notice when the tools listing fails", async () => {
    api.listCollectionTools.mockRejectedValueOnce(new Error("tools down"));
    render(<CollectionSearch collectionId="col-err" token="token" />);
    await waitFor(() => {
      expect(screen.getByText(/load this collection/i)).toBeInTheDocument();
    });
    expect(screen.getByText("top_k")).toBeInTheDocument();
  });

  it("labels a declared argument in words and keeps its key beside the control", async () => {
    api.listCollectionTools.mockResolvedValueOnce({
      tools: [
        makeCollectionTool({
          id: "b-limit",
          arguments: [
            {
              name: "result_limit",
              type: "integer",
              description: "Results returned.",
              required: false,
              default: 5,
              minimum: 1,
              maximum: 50,
              choices: [],
              expose_to_llm: false,
            },
          ],
        }),
      ],
      ingest_pipeline_id: null,
    });
    render(<CollectionSearch collectionId="col-labels" token="token" />);

    expect(await screen.findByText("Result limit")).toBeInTheDocument();
    expect(screen.getByText("result_limit")).toBeInTheDocument();
    // The key stays quotable to a screen reader: it is what the request sends.
    expect(
      screen.getByRole("spinbutton", { name: "Result limit (result_limit)" }),
    ).toBeInTheDocument();
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
      name: "Include archived (include_archived)",
    });
    fireEvent.change(screen.getByLabelText(queryInputLabel), { target: { value: "Find" } });
    fireEvent.click(booleanControl);
    fireEvent.click(screen.getByRole("option", { name: "false" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    expect(api.invokeCollectionTool).toHaveBeenCalledWith(
      "token",
      "col-required-bool",
      "b-primary",
      {
        query: "Find",
        arguments: { include_archived: false },
      },
    );
  });

  describe("image queries", () => {
    const attachLabel = "Attach an image";
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    // `FileReader` resolves on a task, not a microtask, so flushing act's
    // microtask queue is not enough — the caller waits on the outcome it
    // expects.
    async function attach(file: File) {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error("The composer rendered no file input.");
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await act(async () => {
        fireEvent.change(input);
      });
    }

    async function attachImage(file: File) {
      await attach(file);
      await waitFor(() => {
        expect(screen.getByAltText(file.name)).toBeInTheDocument();
      });
    }

    it("runs an image on its own, with no text typed", async () => {
      render(<CollectionSearch collectionId="col-1" token="token" />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: attachLabel })).toBeEnabled();
      });
      expect(screen.getByRole("button", { name: runQueryLabel })).toBeDisabled();

      await attachImage(new File([pngBytes], "page.png", { type: "image/png" }));

      expect(screen.getByRole("button", { name: runQueryLabel })).toBeEnabled();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
      });
      expect(api.runCollectionQuery).toHaveBeenCalledWith("token", "col-1", {
        query: "",
        top_k: 5,
        query_media: { media_type: "image/png", data: expect.any(String) },
      });
    });

    it("refuses a file that is not a supported image, naming the reason", async () => {
      render(<CollectionSearch collectionId="col-1" token="token" />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: attachLabel })).toBeEnabled();
      });

      await attach(new File(["notes"], "notes.txt", { type: "text/plain" }));

      expect(screen.getByText(/'notes.txt' is not a supported image type\./)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: runQueryLabel })).toBeDisabled();
    });

    it("removes an attached image and disables the run again", async () => {
      render(<CollectionSearch collectionId="col-1" token="token" />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: attachLabel })).toBeEnabled();
      });
      await attachImage(new File([pngBytes], "page.png", { type: "image/png" }));

      fireEvent.click(screen.getByRole("button", { name: "Remove page.png" }));

      expect(screen.queryByAltText("page.png")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: runQueryLabel })).toBeDisabled();
    });

    it("disables attaching when the pipeline states it cannot read image queries", async () => {
      api.fetchCollectionQueryArguments.mockResolvedValueOnce({
        arguments: [],
        accepts_query_media: false,
      });
      render(<CollectionSearch collectionId="col-text-only" token="token" />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: attachLabel })).toBeDisabled();
      });
    });
  });
});
