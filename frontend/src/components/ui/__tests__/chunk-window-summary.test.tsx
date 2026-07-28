import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChunkWindowSummary } from "@/components/ui/chunk-window-summary";

/** Text content with whitespace collapsed, so assertions ignore JSX seams. */
const summaryText = () => screen.getByText(/Each chunk is/).textContent?.replace(/\s+/g, " ");

describe("ChunkWindowSummary", () => {
  it("states the tokens per chunk, not the size-plus-overlap sum", () => {
    // The misreading this exists to prevent is "496 of new text + 99 on top";
    // 595 must never appear, and 496 must be named as what the embedder sees.
    render(<ChunkWindowSummary chunkSize={496} chunkOverlap={99} />);

    expect(summaryText()).toBe(
      "Each chunk is 496 tokens: 397 of new text plus 99 repeated from the previous chunk (20% of chunk size).",
    );
  });

  it("names the model's usable window against its published limit", () => {
    render(
      <ChunkWindowSummary
        chunkSize={496}
        chunkOverlap={99}
        limit={{ value: 496, modelName: "all-MiniLM-L6-v2", published: 512 }}
      />,
    );

    expect(summaryText()).toContain("all-MiniLM-L6-v2 accepts 496 (512 less 16 reserved).");
  });

  it("states the overlap as a share of chunk size, since the default is a ratio", () => {
    render(<ChunkWindowSummary chunkSize={1024} chunkOverlap={256} />);

    expect(summaryText()).toContain("256 repeated from the previous chunk (25% of chunk size)");
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

    expect(summaryText()).toBe("Each chunk is 512 tokens: 512 of new text.");
  });

  it("counts words for a word-based chunker", () => {
    render(<ChunkWindowSummary chunkSize={512} chunkOverlap={64} unit="words" />);

    expect(summaryText()).toContain("512 words");
  });

  it("replaces the breakdown with the rule when overlap is not smaller than the size", () => {
    render(<ChunkWindowSummary chunkSize={256} chunkOverlap={256} />);

    expect(screen.getByText("Overlap must be smaller than chunk size.")).toBeInTheDocument();
    expect(screen.queryByText(/Each chunk is/)).toBeNull();
  });
});
