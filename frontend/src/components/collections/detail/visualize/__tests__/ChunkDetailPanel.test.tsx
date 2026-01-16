import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChunkDetailPanel } from "@/components/collections/detail/visualize/ChunkDetailPanel";

import type { ChunkDetail, UmapPoint } from "@/lib/types";

describe("ChunkDetailPanel", () => {
  const baseTimestamp = "2024-01-01T00:00:00.000Z";
  const selectedPoint: UmapPoint = {
    id: "point-1",
    chunk_id: "chunk-1",
    document_id: "doc-1",
    chunk_index: 0,
    x: 1,
    y: 2,
  };

  const detail: ChunkDetail = {
    document: {
      id: "doc-1",
      user_id: "user-1",
      name: "Doc",
      content_type: "text/plain",
      size_bytes: 42,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
    chunk: {
      id: "chunk-1",
      document_id: "doc-1",
      chunk_index: 0,
      text: "Chunk text",
      metadata: { source: "manual" },
      chunk_size: 12,
      chunk_strategy: "token",
      created_at: baseTimestamp,
    },
  };

  it("shows placeholder states", () => {
    const { rerender, container } = render(
      <ChunkDetailPanel detail={null} loading={false} selectedPoint={null} errorMessage={null} />,
    );
    expect(screen.getByText(/Select a point/)).toBeInTheDocument();

    rerender(
      <ChunkDetailPanel detail={null} loading selectedPoint={selectedPoint} errorMessage={null} />,
    );
    expect(container.querySelector("span")).toBeInTheDocument();

    rerender(
      <ChunkDetailPanel
        detail={null}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage="Failed"
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();

    rerender(
      <ChunkDetailPanel
        detail={null}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
      />,
    );
    expect(screen.getByText(/No chunk details/)).toBeInTheDocument();
  });

  it("renders chunk details", () => {
    const onExpand = vi.fn();
    render(
      <ChunkDetailPanel
        detail={detail}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
        onExpand={onExpand}
      />,
    );

    expect(screen.getByText("Doc")).toBeInTheDocument();
    expect(screen.getByText(/Indexed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onExpand).toHaveBeenCalled();

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("token")).toBeInTheDocument();
    expect(screen.getByText(/12 tokens/)).toBeInTheDocument();
    expect(screen.getByText("Chunk text")).toBeInTheDocument();
    expect(screen.getByText(/source/)).toBeInTheDocument();
  });

  it("omits expand button when unavailable", () => {
    render(
      <ChunkDetailPanel
        detail={detail}
        loading={false}
        selectedPoint={selectedPoint}
        errorMessage={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand" })).not.toBeInTheDocument();
  });
});
