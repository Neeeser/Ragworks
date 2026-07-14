"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionVisualization } from "@/components/collections/detail/visualize/CollectionVisualization";
import * as apiModule from "@/lib/api";
import { makeChunkDetail, makeUmapVisualization } from "@/test/fixtures";

import type { ReactNode } from "react";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const selectPointLabel = "Select point";
const umapProjectionHeading = "UMAP projection";
const recomputeUmapLabel = "Recompute";
const unableToLoadUmapMessage = "Unable to load UMAP.";

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
  const visualization = makeUmapVisualization();
  const chunkDetail = makeChunkDetail();

  it("shows load errors and empty state", async () => {
    api.fetchCollectionUmap.mockRejectedValueOnce(new Error(unableToLoadUmapMessage));
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText(unableToLoadUmapMessage)).toBeInTheDocument();
    });
    expect(
      screen.getByText("Upload documents, then compute a projection to plot their embeddings."),
    ).toBeInTheDocument();
  });

  it("falls back to default load errors", async () => {
    api.fetchCollectionUmap.mockRejectedValueOnce("bad");
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText(unableToLoadUmapMessage)).toBeInTheDocument();
    });
  });

  it("renders visualization and loads chunk details", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockResolvedValueOnce(visualization);
    api.fetchChunkDetail.mockResolvedValueOnce(chunkDetail);

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText(umapProjectionHeading)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(recomputeUmapLabel));
    });

    fireEvent.click(screen.getByText(selectPointLabel));
    await waitFor(() => {
      expect(api.fetchChunkDetail).toHaveBeenCalledWith("token", "chunk-1");
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
      expect(screen.getByText(umapProjectionHeading)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(recomputeUmapLabel));
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
      expect(screen.getByText(umapProjectionHeading)).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, element) => element?.tagName === "SPAN" && element.textContent === "1 points",
        ),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Select a point to see chunk details.")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(selectPointLabel));
    });

    await waitFor(() => {
      expect(api.fetchChunkDetail).toHaveBeenCalledWith("token", "chunk-1");
      expect(screen.getByText("Trace failed.")).toBeInTheDocument();
    });
  });

  it("handles compute and chunk errors with non-error values", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockRejectedValueOnce("bad");
    api.fetchChunkDetail.mockRejectedValueOnce("missing");

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText(umapProjectionHeading)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(recomputeUmapLabel));
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
