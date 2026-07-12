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
  it("shows counts with growth charts instead of a raw collection id", async () => {
    renderOverview();

    await waitFor(() => {
      expect(api.fetchCollectionStatsHistory).toHaveBeenCalledWith("token", "col-1", "7d");
    });
    // Hero counts come from stats.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    // The raw UUID is no longer rendered as text; it's behind a copy action.
    expect(screen.queryByText("col-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy id/i })).toBeInTheDocument();
  });

  it("changing the time range refetches history at that range", async () => {
    renderOverview();
    await waitFor(() => {
      expect(api.fetchCollectionStatsHistory).toHaveBeenCalledWith("token", "col-1", "7d");
    });

    fireEvent.click(screen.getByRole("button", { name: "4h" }));

    await waitFor(() => {
      expect(api.fetchCollectionStatsHistory).toHaveBeenCalledWith("token", "col-1", "4h");
    });
  });

  it("splits latency into ingestion and retrieval with a details drill-in", async () => {
    renderOverview();

    await waitFor(() => {
      expect(screen.getAllByText("Ingestion").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Retrieval").length).toBeGreaterThan(0);
    // Weighted window averages from the fixture buckets.
    expect(screen.getByText("900 ms")).toBeInTheDocument();
    expect(screen.getByText("40 ms")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "p95" })).toBeInTheDocument();
    expect(screen.getAllByText("Worst p95").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "p95" }));
    expect(screen.getByRole("button", { name: "p95" })).toHaveAttribute("aria-pressed", "true");
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
      collection: makeCollection({ ingestion_pipeline_id: null, retrieval_pipeline_id: null }),
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
      collection: makeCollection({ ingestion_pipeline_id: null, retrieval_pipeline_id: null }),
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

  it("shows an empty latency state when the window has no samples", async () => {
    api.fetchCollectionStatsHistory.mockResolvedValueOnce(
      makeStatsHistory({
        points: [
          {
            bucket_start: "2024-01-01T00:00:00Z",
            document_total: 0,
            chunk_total: 0,
            ingestion: { count: 0 },
            retrieval: { count: 0 },
          },
        ],
      }),
    );
    renderOverview({ stats: null });

    await waitFor(() => {
      expect(screen.getByText("No runs or queries in this window yet.")).toBeInTheDocument();
    });
  });

  it("surfaces history load failures", async () => {
    api.fetchCollectionStatsHistory.mockRejectedValueOnce(new Error("History failed"));
    renderOverview();

    await waitFor(() => {
      expect(screen.getByText("History failed")).toBeInTheDocument();
    });
  });
});
