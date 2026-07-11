"use client";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionDetail } from "@/components/collections/detail/CollectionDetail";
import * as apiModule from "@/lib/api";
import { makeCollection, makeCollectionStats, makePipeline } from "@/test/fixtures";
import { resetMockAuth, setMockAuth } from "@/test/mocks";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

vi.mock("@/components/collections/detail/CollectionSidebar", () => ({
  CollectionSidebar: ({
    onSelectView,
  }: {
    onSelectView: (view: "overview" | "search" | "visualize") => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectView("overview")}>
        Show overview
      </button>
      <button type="button" onClick={() => onSelectView("search")}>
        Show search
      </button>
      <button type="button" onClick={() => onSelectView("visualize")}>
        Show visualize
      </button>
    </div>
  ),
}));

vi.mock("@/components/collections/detail/CollectionOverview", () => ({
  CollectionOverview: () => <div data-testid="overview" />,
}));

vi.mock("@/components/collections/detail/CollectionSearch", () => ({
  CollectionSearch: () => <div data-testid="search" />,
}));

vi.mock("@/components/collections/detail/visualize/CollectionVisualization", () => ({
  CollectionVisualization: () => <div data-testid="visualize" />,
}));

describe("CollectionDetail", () => {
  const collection = makeCollection();
  const stats = makeCollectionStats();
  const pipeline = makePipeline({ kind: "ingestion" });

  beforeEach(() => {
    resetMockAuth();
    api.fetchCollection.mockResolvedValue(collection);
    api.fetchCollectionStatsById.mockResolvedValue(stats);
    api.fetchPipelines.mockResolvedValue([pipeline]);
  });

  it("renders a loader while fetching", () => {
    api.fetchCollection.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<CollectionDetail collectionId="col-1" />);
    // Loader is a decorative <span> with no accessible role; assert the loading
    // state by confirming the loader renders and no content/error is shown yet.
    expect(container.querySelector("span")).toBeInTheDocument();
    expect(screen.queryByTestId("overview")).not.toBeInTheDocument();
  });

  it("shows a message when token is missing", async () => {
    setMockAuth({ token: null, user: null });
    render(<CollectionDetail collectionId="col-1" />);
    await waitFor(() => {
      expect(screen.getByText("Sign in to view this collection.")).toBeInTheDocument();
    });
  });

  it("renders each detail view", async () => {
    render(<CollectionDetail collectionId="col-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("overview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Show search"));
    expect(screen.getByTestId("search")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Show visualize"));
    expect(screen.getByTestId("visualize")).toBeInTheDocument();
  });

  it("handles load errors", async () => {
    api.fetchCollection.mockRejectedValueOnce(new Error("Failed"));
    render(<CollectionDetail collectionId="col-1" />);

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
  });

  it("handles load errors without Error objects", async () => {
    api.fetchCollection.mockRejectedValueOnce("bad");
    render(<CollectionDetail collectionId="col-1" />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load collection.")).toBeInTheDocument();
    });
  });

  it("shows fallback message when collection is unavailable", async () => {
    api.fetchCollection.mockResolvedValueOnce(null as unknown as Collection);
    render(<CollectionDetail collectionId="col-1" />);

    await waitFor(() => {
      expect(screen.getByText("Collection not available.")).toBeInTheDocument();
    });
  });

  it("avoids state updates after unmount", async () => {
    let resolveCollection!: (value: Collection) => void;
    let resolveStats!: (value: CollectionStats) => void;
    let resolvePipelines!: (value: Pipeline[]) => void;
    const collectionPromise = new Promise<Collection>((resolve) => {
      resolveCollection = resolve;
    });
    const statsPromise = new Promise<CollectionStats>((resolve) => {
      resolveStats = resolve;
    });
    const pipelinePromise = new Promise<Pipeline[]>((resolve) => {
      resolvePipelines = resolve;
    });

    api.fetchCollection.mockReturnValueOnce(collectionPromise);
    api.fetchCollectionStatsById.mockReturnValueOnce(statsPromise);
    api.fetchPipelines.mockReturnValueOnce(pipelinePromise).mockReturnValueOnce(pipelinePromise);

    const { unmount } = render(<CollectionDetail collectionId="col-1" />);
    unmount();

    resolveCollection(collection);
    resolveStats(stats);
    resolvePipelines([pipeline]);
    await Promise.all([collectionPromise, statsPromise, pipelinePromise]);
  });

  it("shows message banner when refresh fails after initial load", async () => {
    const { rerender } = render(<CollectionDetail collectionId="col-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("overview")).toBeInTheDocument();
    });

    api.fetchCollection.mockRejectedValueOnce(new Error("Refresh failed"));
    rerender(<CollectionDetail collectionId="col-2" />);

    await waitFor(() => {
      expect(screen.getByText("Refresh failed")).toBeInTheDocument();
    });
  });
});
