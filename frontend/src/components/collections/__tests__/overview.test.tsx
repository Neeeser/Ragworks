"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionOverview } from "@/components/collections/detail/CollectionOverview";
import * as apiModule from "@/lib/api";
import {
  makeCollection,
  makeCollectionStats,
  makePipeline,
  makeStatsHistory,
} from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
// The overview renders the MCP card, which gates on the public config flag.
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const api = vi.mocked(apiModule);

function renderOverview(overrides: Partial<Parameters<typeof CollectionOverview>[0]> = {}) {
  const props = {
    collection: makeCollection(),
    stats: makeCollectionStats(),
    ingestionPipelines: [
      makePipeline({ id: "pipe-1", name: "Ingest A", kind: "ingestion", is_default: true }),
    ],
    retrievalPipelines: [
      makePipeline({ id: "pipe-2", name: "Retrieve A", kind: "retrieval", is_default: true }),
    ],
    token: "token",
    onCollectionUpdated: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CollectionOverview {...props} />) };
}

describe("CollectionOverview", () => {
  it("loads the collection's whole lifetime, with no range to pick", async () => {
    renderOverview();

    await waitFor(() => {
      expect(api.fetchCollectionStatsHistory).toHaveBeenCalledWith("token", "col-1", null);
    });
    // Hero counts come from stats.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    // The raw UUID is no longer rendered as text; it's behind a copy action.
    expect(screen.queryByText("col-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy id/i })).toBeInTheDocument();
    expect(screen.getByText("All time")).toBeInTheDocument();
  });

  it("refetches the brushed span and offers a way back to the lifetime", async () => {
    renderOverview();
    await waitFor(() => {
      expect(api.fetchCollectionStatsHistory).toHaveBeenCalledWith("token", "col-1", null);
    });

    // Keyboard-select two buckets on the Documents chart, then commit.
    const chart = screen.getAllByRole("group", { name: /Documents over time/ })[0];
    chart.focus();
    // One act per key: batched updates would leave each handler reading the
    // cursor from before the previous key.
    await act(async () => {
      fireEvent.keyDown(chart, { key: "ArrowRight" });
    });
    await act(async () => {
      fireEvent.keyDown(chart, { key: "ArrowRight", shiftKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(chart, { key: "Enter" });
    });

    await waitFor(() => {
      expect(api.fetchCollectionStatsHistory).toHaveBeenCalledWith("token", "col-1", {
        start: "2024-01-01T00:00:00Z",
        end: "2024-01-03T00:00:00.000Z",
      });
    });
    expect(screen.getByText("Zoomed")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    });
    expect(screen.getByText("All time")).toBeInTheDocument();
  });

  it("charts retrieval latency per tool with a legend that carries the numbers", async () => {
    renderOverview();

    // Await the legend row, not a card title: the titles render before the
    // history request resolves, so waiting on one races the series it names.
    // The tool's own name is the series identity, not a generic "Retrieval".
    expect(await screen.findByRole("button", { name: /Search/ })).toBeInTheDocument();
    expect(screen.getByText("Ingestion latency")).toBeInTheDocument();
    expect(screen.getByText("Retrieval latency")).toBeInTheDocument();

    // Collapsed, the legend row already carries its headline average.
    expect(screen.getAllByText("40 ms").length).toBeGreaterThan(0);
  });

  it("hides a tool's line when its legend row is toggled off", async () => {
    renderOverview();

    const row = await screen.findByRole("button", { name: /Search/ });
    expect(row).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(row);
    });
    expect(screen.getByRole("button", { name: /Search/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("copies the collection id from the header action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderOverview();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy id/i }));
    });
    expect(writeText).toHaveBeenCalledWith("col-1");
  });

  it("updates pipeline bindings and reports success", async () => {
    api.updateCollection.mockResolvedValueOnce(makeCollection({ name: "Updated" }));
    const { props } = renderOverview({
      collection: makeCollection({ ingest_pipeline_id: null, tools: [] }),
      ingestionPipelines: [
        makePipeline({ id: "pipe-1", name: "Ingest A", kind: "ingestion", is_default: true }),
        makePipeline({ id: "pipe-3", name: "Ingest B", kind: "ingestion" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Ingestion pipeline" }));
    fireEvent.click(screen.getByRole("option", { name: /Ingest B/ }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    await waitFor(() => {
      expect(props.onCollectionUpdated).toHaveBeenCalled();
      expect(screen.getByText("Pipelines updated.")).toBeInTheDocument();
    });
  });

  it("surfaces pipeline update failures", async () => {
    api.updateCollection.mockRejectedValueOnce(new Error("Update failed"));
    renderOverview({
      collection: makeCollection({ ingest_pipeline_id: null, tools: [] }),
      ingestionPipelines: [
        makePipeline({ id: "pipe-1", name: "Ingest A", kind: "ingestion", is_default: true }),
        makePipeline({ id: "pipe-3", name: "Ingest B", kind: "ingestion" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Ingestion pipeline" }));
    fireEvent.click(screen.getByRole("option", { name: /Ingest B/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Update failed")).toBeInTheDocument();
    });
  });

  it("shows empty latency states when the domain has no samples", async () => {
    api.fetchCollectionStatsHistory.mockResolvedValueOnce(
      makeStatsHistory({
        points: [
          {
            bucket_start: "2024-01-01T00:00:00Z",
            document_total: 0,
            chunk_total: 0,
            ingestion: { count: 0 },
            tools: {},
          },
        ],
        tools: [],
        ingestion_summary: { count: 0 },
      }),
    );
    renderOverview({ stats: null });

    await waitFor(() => {
      expect(screen.getByText("No completed ingest runs in this range.")).toBeInTheDocument();
    });
    expect(screen.getByText("No queries recorded in this range.")).toBeInTheDocument();
  });

  it("surfaces history load failures", async () => {
    api.fetchCollectionStatsHistory.mockRejectedValueOnce(new Error("History failed"));
    renderOverview();

    await waitFor(() => {
      expect(screen.getByText("History failed")).toBeInTheDocument();
    });
  });
});
