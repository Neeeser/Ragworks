"use client";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionDetail } from "@/components/collections/detail/CollectionDetail";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";

const api = {
  fetchCollection: vi.fn(),
  fetchCollectionStatsById: vi.fn(),
  fetchPipelines: vi.fn(),
};

let mockToken: string | null = "token";

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ token: mockToken }),
}));

vi.mock("@/lib/api", () => ({
  fetchCollection: (...args: unknown[]) => api.fetchCollection(...args),
  fetchCollectionStatsById: (...args: unknown[]) => api.fetchCollectionStatsById(...args),
  fetchPipelines: (...args: unknown[]) => api.fetchPipelines(...args),
}));

vi.mock("@/components/collections/detail/CollectionSidebar", () => ({
  CollectionSidebar: ({
    onSelectView,
  }: {
    onSelectView: (view: "overview" | "search" | "documents" | "visualize") => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectView("overview")}>
        Show overview
      </button>
      <button type="button" onClick={() => onSelectView("search")}>
        Show search
      </button>
      <button type="button" onClick={() => onSelectView("documents")}>
        Show documents
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

vi.mock("@/components/collections/detail/CollectionDocuments", () => ({
  CollectionDocuments: () => <div data-testid="documents" />,
}));

vi.mock("@/components/collections/detail/visualize/CollectionVisualization", () => ({
  CollectionVisualization: () => <div data-testid="visualize" />,
}));

describe("CollectionDetail", () => {
  const baseTimestamp = "2024-01-01T00:00:00.000Z";
  const collection: Collection = {
    id: "col-1",
    user_id: "user-1",
    name: "Collection",
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  };
  const stats: CollectionStats = {
    collection_id: "col-1",
    document_count: 1,
    chunk_count: 2,
    average_latency_ms: null,
    last_used_at: null,
  };
  const pipeline: Pipeline = {
    id: "pipe-1",
    user_id: "user-1",
    name: "Pipeline",
    kind: "ingestion",
    current_version: 1,
    is_default: false,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    definition: { nodes: [], edges: [] },
  };

  beforeEach(() => {
    mockToken = "token";
    api.fetchCollection.mockReset();
    api.fetchCollectionStatsById.mockReset();
    api.fetchPipelines.mockReset();
    api.fetchCollection.mockResolvedValue(collection);
    api.fetchCollectionStatsById.mockResolvedValue(stats);
    api.fetchPipelines.mockResolvedValue([pipeline]);
  });

  it("renders a loader while fetching", async () => {
    api.fetchCollection.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<CollectionDetail collectionId="col-1" />);
    expect(container.querySelector("span")).toBeInTheDocument();
  });

  it("shows a message when token is missing", async () => {
    mockToken = null;
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

    fireEvent.click(screen.getByText("Show documents"));
    expect(screen.getByTestId("documents")).toBeInTheDocument();

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
    let resolveCollection: (value: Collection) => void;
    let resolveStats: (value: CollectionStats) => void;
    let resolvePipelines: (value: Pipeline[]) => void;
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
