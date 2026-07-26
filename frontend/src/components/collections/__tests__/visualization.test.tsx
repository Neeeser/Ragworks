"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionVisualization } from "@/components/collections/detail/visualize/CollectionVisualization";
import * as apiModule from "@/lib/api";
import { makeChunk, makeChunkDetail, makeUmapPoint, makeUmapVisualization } from "@/test/fixtures";

import type { ReactNode } from "react";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const selectPointLabel = "Select point";
const recomputeLabel = "Recompute UMAP";
const unableToLoadUmapMessage = "Unable to load UMAP.";
const closeChunkPaneLabel = "Close chunk details";

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
        {/* One button per further point, so a test can select two in a row and
            control the order their chunk requests resolve in. */}
        {points.slice(1).map((point, index) => (
          <button key={point.id} type="button" onClick={() => onSelectPoint(point)}>
            {`Select point ${index + 2}`}
          </button>
        ))}
      </div>
    );
  },
}));

describe("CollectionVisualization", () => {
  const visualization = makeUmapVisualization();
  const chunkDetail = makeChunkDetail();

  it("shows load errors and the empty plot", async () => {
    api.fetchCollectionUmap.mockRejectedValueOnce(new Error(unableToLoadUmapMessage));
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText(unableToLoadUmapMessage)).toBeInTheDocument();
    });
    expect(screen.getByText(/Computing one places every indexed chunk/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compute UMAP" })).toBeInTheDocument();
  });

  it("falls back to default load errors", async () => {
    api.fetchCollectionUmap.mockRejectedValueOnce("bad");
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText(unableToLoadUmapMessage)).toBeInTheDocument();
    });
  });

  it("reports the stored projection's parameters", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
    });
    expect(screen.getByText("Points")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    // The model id is both the readout's value and its tooltip, because the
    // column truncates it.
    expect(screen.getAllByText("embed-1").length).toBeGreaterThan(0);
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("cosine")).toBeInTheDocument();
  });

  it("renders visualization and loads chunk details", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockResolvedValueOnce(visualization);
    api.fetchChunkDetail.mockResolvedValueOnce(chunkDetail);

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: recomputeLabel }));
    });

    fireEvent.click(screen.getByText(selectPointLabel));
    await waitFor(() => {
      expect(api.fetchChunkDetail).toHaveBeenCalledWith("token", "chunk-1");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("group", { name: "Render mode" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close preview"));
  });

  it("closes the chunk pane and gives the plot the width back", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.fetchChunkDetail.mockResolvedValueOnce(chunkDetail);

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(selectPointLabel));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: closeChunkPaneLabel })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: closeChunkPaneLabel }));
    expect(screen.queryByRole("button", { name: closeChunkPaneLabel })).not.toBeInTheDocument();
  });

  it("surfaces compute errors with Error messages", async () => {
    api.fetchCollectionUmap.mockResolvedValueOnce(visualization);
    api.computeCollectionUmap.mockRejectedValueOnce(new Error("Compute boom"));

    render(<CollectionVisualization collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: recomputeLabel }));
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
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: recomputeLabel }));
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

describe("CollectionVisualization chunk request ordering", () => {
  const twoPoints = makeUmapVisualization({
    points: [makeUmapPoint(), makeUmapPoint({ id: "pt-2", chunk_id: "chunk-2" })],
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("shows the chunk of the point clicked last when responses arrive out of order", async () => {
    // Two clicks, the first one slower. Without a request generation the late
    // response overwrites the newer one, so the inspector docks the first
    // point's chunk beside the second point's selection.
    const first = deferred<Awaited<ReturnType<typeof api.fetchChunkDetail>>>();
    const second = deferred<Awaited<ReturnType<typeof api.fetchChunkDetail>>>();
    api.fetchCollectionUmap.mockResolvedValueOnce(twoPoints);
    api.fetchChunkDetail.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<CollectionVisualization collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: recomputeLabel })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(selectPointLabel));
    fireEvent.click(screen.getByText("Select point 2"));

    await act(async () => {
      second.resolve(makeChunkDetail({ chunk: makeChunk({ text: "Second chunk body." }) }));
      first.resolve(makeChunkDetail({ chunk: makeChunk({ text: "First chunk body." }) }));
    });

    expect(screen.getByText("Second chunk body.")).toBeInTheDocument();
    expect(screen.queryByText("First chunk body.")).not.toBeInTheDocument();
  });
});
