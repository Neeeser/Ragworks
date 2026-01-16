"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionVisualization } from "@/components/collections/detail/visualize/CollectionVisualization";

import type { ChunkDetail, UmapVisualization } from "@/lib/types";
import type { ReactNode } from "react";

const baseTimestamp = "2024-01-01T00:00:00.000Z";
const selectPointLabel = "Select point";

const api = {
  computeCollectionUmap: vi.fn(),
  fetchChunkDetail: vi.fn(),
  fetchCollectionUmap: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  computeCollectionUmap: (...args: unknown[]) => api.computeCollectionUmap(...args),
  fetchChunkDetail: (...args: unknown[]) => api.fetchChunkDetail(...args),
  fetchCollectionUmap: (...args: unknown[]) => api.fetchCollectionUmap(...args),
}));

vi.mock("@/components/collections/detail/visualize/UmapCanvas", () => ({
  UmapCanvas: () => null,
}));

vi.mock("next/dynamic", () => ({
  default: (loader: unknown, options?: { loading?: () => ReactNode }) => {
    if (typeof loader === "function") {
      void (loader as () => Promise<unknown>)().catch(() => undefined);
    }
    return ({
      onSelectPoint,
      points,
    }: {
      onSelectPoint: (point: { id: string }) => void;
      points: Array<{ id: string }>;
    }) => (
      <div>
        {options?.loading?.()}
        <button type="button" onClick={() => onSelectPoint(points[0])}>
          Select point
        </button>
      </div>
    );
  },
}));

describe("CollectionVisualization", () => {
  const visualization: UmapVisualization = {
    projection: {
      id: "proj-1",
      embedding_model: "model",
      point_count: 1,
      created_at: baseTimestamp,
    },
    points: [{ id: "point-1", chunk_id: "chunk-1", chunk_index: 0, x: 0.1, y: 0.2 }],
  };
  const chunkDetail: ChunkDetail = {
    document: {
      id: "doc-1",
      collection_id: "col-1",
      name: "Doc",
      content_type: "text/plain",
      status: "ready",
      num_chunks: 1,
      num_tokens: 10,
      chunk_size: 256,
      chunk_overlap: 0,
      chunk_strategy: "token",
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
    chunk: {
      id: "chunk-1",
      document_id: "doc-1",
      chunk_index: 0,
      text: "Chunk text",
      metadata: {},
      chunk_size: 256,
      chunk_strategy: "token",
      created_at: baseTimestamp,
    },
  };

  it("shows load errors and empty state", async () => {
    api.fetchCollectionUmap.mockRejectedValueOnce(new Error("Unable to load UMAP."));
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load UMAP.")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Upload documents and compute a projection to explore the collection."),
    ).toBeInTheDocument();
  });

  it("falls back to default load errors", async () => {
    api.fetchCollectionUmap.mockRejectedValueOnce("bad");
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load UMAP.")).toBeInTheDocument();
    });
  });

  it("renders visualization and loads chunk details", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockResolvedValueOnce(visualization);
    api.fetchChunkDetail.mockResolvedValueOnce(chunkDetail);

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("UMAP Projection")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Recompute UMAP"));
    });

    fireEvent.click(screen.getByText(selectPointLabel));
    await waitFor(() => {
      expect(api.fetchChunkDetail).toHaveBeenCalledWith("chunk-1", "token");
    });
    await waitFor(() => {
      expect(screen.getByText("Expand")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Expand"));
    expect(screen.getByText("Chunk preview")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close preview"));
  });

  it("surfaces compute errors with Error messages", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockRejectedValueOnce(new Error("Compute boom"));

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("UMAP Projection")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Recompute UMAP"));
    });

    await waitFor(() => {
      expect(screen.getByText("Compute boom")).toBeInTheDocument();
    });
  });

  it("handles chunk detail errors", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.fetchChunkDetail.mockRejectedValueOnce(new Error("Trace failed."));

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("UMAP Projection")).toBeInTheDocument();
      expect(screen.getByText(/1 points/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Select a point to see chunk details.")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(selectPointLabel));
    });

    await waitFor(() => {
      expect(api.fetchChunkDetail).toHaveBeenCalledWith("chunk-1", "token");
      expect(screen.getByText("Trace failed.")).toBeInTheDocument();
    });
  });

  it("handles compute and chunk errors with non-error values", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockRejectedValueOnce("bad");
    api.fetchChunkDetail.mockRejectedValueOnce("missing");

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("UMAP Projection")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Recompute UMAP"));
    });

    await waitFor(() => {
      expect(screen.getByText("Unable to compute UMAP.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(selectPointLabel));
    await waitFor(() => {
      expect(screen.getByText("Unable to load chunk details.")).toBeInTheDocument();
    });
  });
});
