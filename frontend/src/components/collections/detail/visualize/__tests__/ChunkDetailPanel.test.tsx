import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChunkDetailPanel } from "@/components/collections/detail/visualize/ChunkDetailPanel";
import { makeChunk, makeChunkDetail, makeDocument, makeInsightPoint } from "@/test/fixtures";

describe("ChunkDetailPanel", () => {
  const selectedPoint = makeInsightPoint({ id: "point-1", x: 1, y: 2 });

  const detail = makeChunkDetail({
    document: makeDocument({ name: "Doc", chunk_size: 12 }),
    chunk: makeChunk({
      chunk_size: 12,
      text: "The stored chunk body.",
      metadata: { source: "manual" },
    }),
  });

  const noop = () => {};

  it("renders nothing until a point is selected, so the plot keeps the width", () => {
    const { container } = render(
      <ChunkDetailPanel
        detail={null}
        loading={false}
        selectedPoint={null}
        errorMessage={null}
        onClose={noop}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows the loading, error, and missing-detail states", () => {
    const { rerender } = render(
      <ChunkDetailPanel
        detail={null}
        loading
        selectedPoint={selectedPoint}
        errorMessage={null}
        onClose={noop}
      />,
    );
    // The skeleton stands in at the pane's final geometry, so nothing reflows
    // when the chunk lands.
    expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);

    rerender(
      <ChunkDetailPanel
        detail={null}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage="Failed"
        onClose={noop}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();

    rerender(
      <ChunkDetailPanel
        detail={null}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
        onClose={noop}
      />,
    );
    expect(screen.getByText(/No chunk details/)).toBeInTheDocument();
  });

  it("renders the chunk's record and text", () => {
    const onExpand = vi.fn();
    render(
      <ChunkDetailPanel
        detail={detail}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
        onClose={noop}
        onExpand={onExpand}
      />,
    );

    expect(screen.getByRole("heading", { name: "Doc" })).toBeInTheDocument();
    expect(screen.getByText("Indexed")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("token")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Chunk text")).toBeInTheDocument();
    expect(screen.getByText("The stored chunk body.")).toBeInTheDocument();
    expect(screen.getByText(/source/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onExpand).toHaveBeenCalled();
  });

  it("clears the selection from its close control", () => {
    const onClose = vi.fn();
    render(
      <ChunkDetailPanel
        detail={detail}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close chunk details" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("omits expand button when unavailable", () => {
    render(
      <ChunkDetailPanel
        detail={detail}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
        onClose={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
  });
});
