import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChunkPreviewOverlay } from "@/components/collections/detail/visualize/ChunkPreviewOverlay";
import { makeChunk, makeChunkDetail } from "@/test/fixtures";

import type { ChunkDetail } from "@/lib/types";

const detail = makeChunkDetail({ chunk: makeChunk({ text: "Hello" }) });

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
    fireEvent.click(screen.getByLabelText("Close preview"));
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
      // Deliberately malformed to exercise the missing-text rendering path.
      chunk: { ...detail.chunk, text: undefined as unknown as string },
    };

    render(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={noTextDetail} />);

    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("resets to the default render mode when a different chunk loads, without needing a remount key", () => {
    const otherDetail: ChunkDetail = {
      ...detail,
      chunk: { ...detail.chunk, id: "chunk-2", text: "World" },
    };

    const { rerender } = render(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={detail} />);

    fireEvent.click(screen.getByText("Markdown"));

    // Same component instance (no `key`) - switching to a different chunk while still
    // open should snap back to the default mode instead of carrying the manual toggle.
    rerender(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={otherDetail} />);

    expect(screen.getByText("World")).toBeInTheDocument();
    // Active tab state is only expressed through styling (no aria-pressed handle).
    const plainButton = screen.getByText("Plain");
    expect(plainButton.className).toContain("bg-violet-500/20");
  });

  it("resets to the default render mode when reopened after closing", () => {
    const { rerender } = render(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={detail} />);

    fireEvent.click(screen.getByText("Markdown"));
    rerender(<ChunkPreviewOverlay isOpen={false} onClose={() => {}} detail={detail} />);
    rerender(<ChunkPreviewOverlay isOpen onClose={() => {}} detail={detail} />);

    const plainButton = screen.getByText("Plain");
    expect(plainButton.className).toContain("bg-violet-500/20");
  });
});
