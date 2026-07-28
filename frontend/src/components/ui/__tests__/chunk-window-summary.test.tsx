import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChunkWindowSummary } from "@/components/ui/chunk-window-summary";

/** Text content with whitespace collapsed, so assertions ignore JSX seams. */
const summaryText = () => screen.getByText(/Each chunk is/).textContent?.replace(/\s+/g, " ");

describe("ChunkWindowSummary", () => {
  it("states the sum the embedder receives, since overlap is added to the size", () => {
    render(<ChunkWindowSummary chunkSize={413} chunkOverlap={83} />);

    expect(summaryText()).toBe(
      "Each chunk is 413 tokens of new text plus 83 of overlap = 496 tokens sent to the embedder.",
    );
  });

  it("names the model's usable window against its published limit", () => {
    render(
      <ChunkWindowSummary
        chunkSize={413}
        chunkOverlap={83}
        limit={{ value: 496, modelName: "all-MiniLM-L6-v2", published: 512 }}
      />,
    );

    expect(summaryText()).toContain("all-MiniLM-L6-v2 accepts 496 (512 less 16 reserved).");
    expect(screen.queryByText(/Over the limit/)).toBeNull();
  });

  it("warns, with the consequence, when the sum exceeds the model limit", () => {
    // 512 + 102 = 614 against a 496 window: the old semantics would have
    // called this a fitting 512, which is exactly the trap being closed.
    render(
      <ChunkWindowSummary
        chunkSize={512}
        chunkOverlap={102}
        limit={{ value: 496, modelName: "all-MiniLM-L6-v2", published: 512 }}
      />,
    );

    const warning = screen.getByText(/Over the limit/).textContent?.replace(/\s+/g, " ");
    expect(warning).toContain("Over the limit by 118 tokens.");
    expect(warning).toContain("split before indexing");
  });

  it("says the window is a run-time fact when an expression sets it", () => {
    // Placeholder zeros would otherwise render a confident, false breakdown.
    render(<ChunkWindowSummary chunkSize={0} chunkOverlap={0} expression />);

    expect(
      screen.getByText("An expression sets the window, so its size is decided per run."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Each chunk is/)).toBeNull();
  });

  it("drops the repetition clause when there is no overlap", () => {
    render(<ChunkWindowSummary chunkSize={512} chunkOverlap={0} />);

    expect(summaryText()).toBe("Each chunk is 512 tokens of new text sent to the embedder.");
  });

  it("counts words for a word-based chunker", () => {
    render(<ChunkWindowSummary chunkSize={512} chunkOverlap={64} unit="words" />);

    expect(summaryText()).toContain("512 words");
  });

  it("allows an overlap larger than the size, which is wasteful but well-defined", () => {
    render(<ChunkWindowSummary chunkSize={100} chunkOverlap={200} />);

    expect(summaryText()).toContain("100 tokens of new text plus 200 of overlap = 300");
  });

  it("rejects a non-positive chunk size", () => {
    render(<ChunkWindowSummary chunkSize={0} chunkOverlap={50} />);

    expect(screen.getByText("Chunk size must be greater than zero.")).toBeInTheDocument();
  });
});
