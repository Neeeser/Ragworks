import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DatasetFormatGuide } from "@/components/evals/DatasetFormatGuide";

describe("DatasetFormatGuide", () => {
  it("documents all three files with example snippets", () => {
    render(<DatasetFormatGuide />);
    expect(screen.getByRole("heading", { name: "corpus.jsonl" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "queries.jsonl" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "qrels (TSV)" })).toBeInTheDocument();
    // The examples render as preformatted blocks users can copy from.
    expect(screen.getByText(/"_id": "doc-001"/)).toBeInTheDocument();
    // Tabs collapse under testing-library's whitespace normalization.
    expect(screen.getByText(/q-002 doc-003 1/)).toBeInTheDocument();
  });

  it("states the TREC zero-score rule the sampler enforces", () => {
    render(<DatasetFormatGuide />);
    expect(screen.getByText(/judged and/)).toBeInTheDocument();
    expect(screen.getByText(/never treated as gold/)).toBeInTheDocument();
  });
});
