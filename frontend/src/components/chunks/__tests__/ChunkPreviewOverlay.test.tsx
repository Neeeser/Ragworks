import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChunkPreviewOverlay } from "@/components/chunks/ChunkPreviewOverlay";

import type { ChunkDetail } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

const detail: ChunkDetail = {
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
    text: "Hello",
    metadata: {},
    chunk_size: 256,
    chunk_strategy: "token",
    created_at: baseTimestamp,
  },
};

describe("ChunkPreviewOverlay", () => {
  it("renders nothing when closed or missing detail", () => {
    const { container, rerender } = render(
      <ChunkPreviewOverlay isOpen={false} onClose={() => {}} detail={detail} />,
    );
    expect(container.firstChild).toBeNull();

    rerender(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders text and markdown modes", () => {
    const onClose = vi.fn();
    render(<ChunkPreviewOverlay isOpen onClose={onClose} detail={detail} />);

    expect(screen.getByText("Hello")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Markdown"));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Plain"));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    const closeButton = document.querySelector('button[aria-label="Close preview"]');
    if (!closeButton) {
      throw new Error("Close button not found");
    }
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("uses fallback markdown when chunk text is empty", () => {
    const emptyDetail: ChunkDetail = {
      ...detail,
      chunk: { ...detail.chunk, text: "" },
    };
    render(
      <ChunkPreviewOverlay
        isOpen
        onClose={() => {}}
        detail={emptyDetail}
        defaultRenderMode="markdown"
      />,
    );

    expect(screen.getByText(/No chunk content available/)).toBeInTheDocument();
  });

  it("renders empty text when chunk text is missing", () => {
    const noTextDetail: ChunkDetail = {
      ...detail,
      chunk: { ...detail.chunk, text: undefined },
    };

    render(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={noTextDetail} />);

    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });
});
