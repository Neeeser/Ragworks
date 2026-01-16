"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSearch } from "@/components/collections/detail/CollectionSearch";

import type { CollectionQueryResult } from "@/lib/types";

const runQueryLabel = "Run query";
const viewTraceLabel = "View retrieval trace";

const api = {
  runCollectionQuery: vi.fn(),
  fetchQueryEventTrace: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  runCollectionQuery: (...args: unknown[]) => api.runCollectionQuery(...args),
  fetchQueryEventTrace: (...args: unknown[]) => api.fetchQueryEventTrace(...args),
}));

vi.mock("@/components/traces/PipelineTraceViewer", () => ({
  PipelineTraceViewer: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="trace-viewer">
        <button type="button" onClick={onClose}>
          Close trace
        </button>
      </div>
    ) : null,
}));

describe("CollectionSearch", () => {
  it("skips empty queries", async () => {
    render(<CollectionSearch collectionId="col-1" token="token" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });
    expect(api.runCollectionQuery).not.toHaveBeenCalled();
  });

  it("runs queries and renders results", async () => {
    const result: CollectionQueryResult = {
      query_event_id: "event-1",
      chunks: [
        {
          id: "chunk-1",
          chunk_id: "chunk-1",
          chunk_index: 0,
          score: 0.7,
          text: "Chunk text",
          metadata: { source: "doc" },
        },
        {
          id: "chunk-2",
          chunk_id: "chunk-2",
          chunk_index: 1,
          score: 0,
          text: "Empty score",
          metadata: null,
        },
        {
          id: "chunk-3",
          chunk_index: 2,
          score: 0.4,
          text: "Fallback id",
          metadata: null,
        },
      ],
    };
    api.runCollectionQuery.mockResolvedValueOnce(result);
    api.fetchQueryEventTrace.mockResolvedValue({ run: { id: "run-1" } });

    render(<CollectionSearch collectionId="col-1" token="token" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Find" } });
    fireEvent.change(screen.getByLabelText("Top K"), { target: { value: "3" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    await waitFor(() => {
      expect(screen.getByText("Chunk text")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(viewTraceLabel));
    await waitFor(() => {
      expect(screen.getByTestId("trace-viewer")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close trace" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Trace result" })[0]);
    await waitFor(() => {
      expect(screen.getByTestId("trace-viewer")).toBeInTheDocument();
    });
    expect(api.fetchQueryEventTrace).toHaveBeenLastCalledWith("event-1", "token");
    fireEvent.click(screen.getByRole("button", { name: "Close trace" }));
    expect(api.fetchQueryEventTrace).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Trace result" })[2]);
    await waitFor(() => {
      expect(screen.getByTestId("trace-viewer")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close trace" }));
  });

  it("handles query and trace errors", async () => {
    api.runCollectionQuery.mockRejectedValueOnce(new Error("Query failed."));
    render(<CollectionSearch collectionId="col-1" token="token" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });
    expect(screen.getByText("Query failed.")).toBeInTheDocument();

    api.runCollectionQuery.mockResolvedValueOnce({ query_event_id: null, chunks: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });
    fireEvent.click(screen.getByText(viewTraceLabel));
    expect(screen.getByText("Trace is not available for this query.")).toBeInTheDocument();

    api.runCollectionQuery.mockResolvedValueOnce({
      query_event_id: "event-2",
      chunks: [{ id: "chunk-3", chunk_index: 0, score: undefined, text: "" }],
    });
    api.fetchQueryEventTrace.mockRejectedValueOnce("Trace failed.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });
    fireEvent.click(screen.getByText(viewTraceLabel));
    await waitFor(() => {
      expect(screen.getByText("Unable to load trace.")).toBeInTheDocument();
    });
  });

  it("uses error messages from trace failures", async () => {
    api.runCollectionQuery.mockResolvedValueOnce({
      query_event_id: "event-3",
      chunks: [{ id: "chunk-4", chunk_index: 0, score: 0.5, text: "Hit" }],
    });
    api.fetchQueryEventTrace.mockRejectedValueOnce(new Error("Trace boom"));

    render(<CollectionSearch collectionId="col-1" token="token" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Find" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    fireEvent.click(screen.getByText(viewTraceLabel));
    await waitFor(() => {
      expect(screen.getByText("Trace boom")).toBeInTheDocument();
    });
  });

  it("falls back for missing scores and text", async () => {
    api.runCollectionQuery.mockResolvedValueOnce({
      query_event_id: "event-4",
      chunks: [
        { id: "chunk-5", chunk_index: 0, score: 0.5, text: "Alpha" },
        { id: "chunk-6", chunk_index: 1, score: undefined, text: undefined },
      ],
    });

    const { container } = render(<CollectionSearch collectionId="col-1" token="token" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Find" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    const zeroBar = container.querySelector('div[style*="width: 0%"]');
    expect(zeroBar).toBeInTheDocument();
  });

  it("uses fallback errors for non-error query failures", async () => {
    api.runCollectionQuery.mockRejectedValueOnce("nope");
    render(<CollectionSearch collectionId="col-1" token="token" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    expect(screen.getByText("Query failed.")).toBeInTheDocument();
  });

  it("renders zero-score bars and handles non-error trace failures", async () => {
    api.runCollectionQuery.mockResolvedValueOnce({
      query_event_id: "event-3",
      chunks: [{ id: "chunk-4", chunk_index: 0, score: 0, text: "Zero score" }],
    });
    api.fetchQueryEventTrace.mockRejectedValueOnce("no trace");

    const { container } = render(<CollectionSearch collectionId="col-1" token="token" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Find" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: runQueryLabel }));
    });

    await waitFor(() => {
      expect(screen.getByText("Zero score")).toBeInTheDocument();
    });

    const zeroBar = container.querySelector('div[style*="width: 0%"]');
    expect(zeroBar).toBeInTheDocument();

    fireEvent.click(screen.getByText(viewTraceLabel));
    await waitFor(() => {
      expect(screen.getByText("Unable to load trace.")).toBeInTheDocument();
    });
  });
});
